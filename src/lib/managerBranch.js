import { supabase } from '@/lib/customSupabaseClient';

/** Prefer public.users.branch_id (source of truth); JWT metadata is often stale after role switches. */
export async function getManagerBranchId(user) {
  if (!user?.id) return null;
  const { data: profile, error } = await supabase
    .from('users')
    .select('branch_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!error && profile?.branch_id) return profile.branch_id;
  if (error) console.error(error);
  return user?.user_metadata?.branch_id ?? null;
}
