import { supabase } from '@/lib/customSupabaseClient';

function shortDeviceSummary(ua) {
  if (!ua) return null;
  let browser = 'Browser';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';
  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  return `${browser} / ${os}`;
}

async function fetchClientNetworkContext() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    const j = await r.json();
    if (j.error) return { ip: null, locationLabel: null };
    const parts = [j.city, j.region, j.country_name].filter(Boolean);
    return {
      ip: j.ip ?? null,
      locationLabel: parts.length ? parts.join(', ') : null,
    };
  } catch {
    return { ip: null, locationLabel: null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Normalizes `get_audit_logs_admin` JSONB payload from PostgREST (object, string, or edge cases).
 */
export function parseAuditRpcPayload(raw) {
  if (raw == null) return { rows: [], total: 0 };
  let p = raw;
  for (let i = 0; i < 2 && typeof p === 'string'; i += 1) {
    try {
      p = JSON.parse(p);
    } catch {
      return { rows: [], total: 0 };
    }
  }
  if (Array.isArray(p)) {
    return { rows: p, total: p.length };
  }
  if (typeof p !== 'object') {
    return { rows: [], total: 0 };
  }
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const total = typeof p.total === 'number' ? p.total : rows.length;
  return { rows, total };
}

/**
 * Append one audit row (RPC). Used after login/logout and can be called from other flows.
 *
 * @param {object} sessionFromEvent - Pass session from `onAuthStateChange(SIGNED_IN)` so JWT is current.
 */
export async function logAudit({ action, entityType, entityId, metadata }, sessionFromEvent = null) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const sessionToUse = sessionFromEvent ?? session;
  if (!sessionToUse?.access_token) return;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const device = shortDeviceSummary(ua);
  const net = await fetchClientNetworkContext();

  try {
    const { error: rpcErr } = await supabase.rpc('log_audit_event', {
      p_action: action,
      p_entity_type: entityType ?? null,
      p_entity_id: entityId != null ? String(entityId) : null,
      p_metadata: metadata ?? {},
      p_ip_address: net.ip,
      p_user_agent: ua,
      p_device_summary: device,
      p_location_label: net.locationLabel,
    });
    if (rpcErr) console.warn('[audit]', rpcErr.message);
  } catch (e) {
    console.warn('[audit]', e);
  }
}
