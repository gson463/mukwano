import { supabase } from '@/lib/customSupabaseClient';

/** JWT metadata is not always in sync with public.users; RLS checks DB branch_id. */
export async function getManagerBranchId(user) {
  const fromMeta = user?.user_metadata?.branch_id;
  if (fromMeta) return fromMeta;
  const { data: profile, error } = await supabase
    .from('users')
    .select('branch_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return profile?.branch_id ?? null;
}
