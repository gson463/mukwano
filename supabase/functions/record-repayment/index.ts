import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  installmentUnitFromSchedule,
  isValidRepaymentAmount,
} from "../_shared/repaymentAmount.ts";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Unauthorized" });
    }
    const jwt = authHeader.replace("Bearer ", "");
    const { data: jwtData, error: jwtErr } = await supabaseAdmin.auth.getUser(jwt);
    if (jwtErr || !jwtData.user?.id) {
      return json(401, { error: "Invalid or expired session" });
    }
    const officer_id = jwtData.user.id;

    const { data: callerRow, error: callerErr } = await supabaseAdmin
      .from("users")
      .select("role, branch_id, is_active")
      .eq("id", officer_id)
      .maybeSingle();
    if (callerErr || !callerRow) {
      return json(403, { error: "User profile not found" });
    }
    if (callerRow.is_active === false) {
      return json(403, { error: "Account is deactivated" });
    }

    const body = await req.json() as Record<string, unknown>;
    const { loan_id, actual_payment_date } = body;
    if (!loan_id || !actual_payment_date) {
      return json(400, { error: "loan_id, actual_payment_date required" });
    }

    const { data: loan, error: loanErr } = await supabaseAdmin
      .from("loans")
      .select("borrower_id, schedule, officer_id")
      .eq("id", loan_id)
      .single();
    if (loanErr || !loan) throw new Error("Loan not found");

    const callerRole = String(callerRow.role ?? "").trim().toLowerCase();
    if (callerRole === "officer") {
      if (String(loan.officer_id) !== officer_id) {
        return json(403, { error: "You can only record repayments for your own loans" });
      }
    } else if (callerRole === "manager") {
      const { data: loanOfficer } = await supabaseAdmin
        .from("users")
        .select("branch_id")
        .eq("id", loan.officer_id)
        .maybeSingle();
      const mgrBranch = callerRow.branch_id ? String(callerRow.branch_id) : null;
      const loanBranch = loanOfficer?.branch_id ? String(loanOfficer.branch_id) : null;
      if (!mgrBranch || !loanBranch || mgrBranch !== loanBranch) {
        return json(403, { error: "Loan is outside your branch" });
      }
    } else if (callerRole !== "admin") {
      return json(403, { error: "Forbidden" });
    }

    const payDate = String(actual_payment_date).slice(0, 10);
    const unit = installmentUnitFromSchedule(loan.schedule);
    if (unit == null) {
      throw new Error("Cannot determine installment unit from loan schedule");
    }

    const walletExplicitFlag =
      body.wallet_split_explicit === true ||
      body.wallet_split_explicit === "true" ||
      body.wallet_split_explicit === 1 ||
      body.wallet_split_explicit === "1";

    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
    const hasSchedKey = has("scheduled_portion");
    const hasPrepKey = has("prepayment_portion");
    const wantsExplicitSplit =
      walletExplicitFlag ||
      (hasSchedKey && hasPrepKey) ||
      (hasPrepKey && body.amount != null && !hasSchedKey);

    let amt: number;
    let prepayment: number;
    let snapshotDue: number;
    let walletSplitExplicit = false;

    if (wantsExplicitSplit) {
      let s: number;
      let p: number;
      if (hasSchedKey && hasPrepKey) {
        s = Number(body.scheduled_portion);
        p = Number(body.prepayment_portion);
      } else if (body.amount != null && hasPrepKey && !hasSchedKey) {
        p = Number(body.prepayment_portion);
        const total = Number(body.amount);
        s = total - p;
      } else {
        throw new Error(
          "Split recording: send scheduled_portion + prepayment_portion, or amount + prepayment_portion.",
        );
      }
      if (!Number.isFinite(s) || !Number.isFinite(p) || s < -1e-9 || p < -1e-9) {
        throw new Error("scheduled_portion and prepayment_portion must be non-negative numbers");
      }
      amt = s + p;
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error("Total (scheduled + prepayment) must be positive");
      }
      if (!isValidRepaymentAmount(amt, 0, unit)) {
        throw new Error(
          `Total must be a multiple of ${unit.toFixed(2)} and at least one installment (${unit.toFixed(2)})`,
        );
      }
      prepayment = p;
      snapshotDue = s;
      walletSplitExplicit = true;
    } else {
      if (body.amount == null) {
        return json(400, { error: "amount required (or scheduled_portion + prepayment_portion)" });
      }
      amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return json(400, { error: "amount must be a positive number" });
      }

      const { data: modeRow } = await supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("key", "walletPrepaymentSplitMode")
        .maybeSingle();
      const splitMode = String(modeRow?.value ?? "standard").trim();
      const dueRpc =
        splitMode === "arrears_only"
          ? "scheduled_due_strictly_before_payment_date"
          : "scheduled_due_for_payment_date";

      const { data: dueRaw, error: dueErr } = await supabaseAdmin.rpc(dueRpc, {
        p_schedule: loan.schedule,
        p_payment_date: payDate,
      });
      if (dueErr) throw dueErr;

      const due = Number(dueRaw ?? 0);
      if (!isValidRepaymentAmount(amt, due, unit)) {
        throw new Error(
          `Amount must be a multiple of ${unit.toFixed(2)} and at least one installment (${unit.toFixed(2)})`,
        );
      }
      prepayment = Math.max(0, amt - due);
      snapshotDue = due;
    }

    const prepSafe = Number.isFinite(prepayment) ? prepayment : 0;
    const snapSafe = Number.isFinite(snapshotDue) ? snapshotDue : 0;
    const walletSrc = walletSplitExplicit ? "explicit" : "rpc";

    const { data: rpcRepaymentId, error: walletRpcErr } = await supabaseAdmin.rpc(
      "record_repayment_wallet_then_recalculate",
      {
        p_loan_id: loan_id,
        p_borrower_id: loan.borrower_id,
        p_amount: amt,
        p_officer_id: officer_id,
        p_actual_payment_date: payDate,
        p_prepayment_amount: prepSafe,
        p_scheduled_due_snapshot: snapSafe,
        p_wallet_split_source: walletSrc,
      },
    );

    if (walletRpcErr) throw walletRpcErr;

    await supabaseAdmin.rpc("update_all_loan_statuses");

    return json(200, {
      message: "Repayment recorded successfully!",
      repayment_id: rpcRepaymentId != null ? String(rpcRepaymentId) : null,
      prepayment_amount: prepSafe,
      scheduled_due_snapshot: snapSafe,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(400, { error: msg });
  }
});
