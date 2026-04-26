import { supabase } from '@/lib/customSupabaseClient';

/** Static asset: “Mukwano Financial Services” (official mark). Used when `system_config.logoUrl` is empty. */
export const DEFAULT_BRAND_LOGO_PATH = '/mukwano-financial-services-logo.png';

export const DEFAULT_ORG_NAME = 'Mukwano Financial Services';

/**
 * Resolves the image to show: admin URL from `system_config` when set, else the bundled default logo.
 */
export function getBrandLogoUrl(logoUrlFromConfig) {
  const u = logoUrlFromConfig && String(logoUrlFromConfig).trim();
  if (u) return u;
  return DEFAULT_BRAND_LOGO_PATH;
}

/**
 * Same mapping as the dashboard sidebar: `system_config` rows (key / value) → { name, logoUrl }.
 */
export function mapSystemConfigRows(data) {
  if (!data?.length) {
    return { name: DEFAULT_ORG_NAME, logoUrl: null };
  }
  const config = data.reduce((acc, item) => {
    acc[item.key] = item.value;
    return acc;
  }, {});
  return {
    name: config.systemName || DEFAULT_ORG_NAME,
    logoUrl: config.logoUrl || null,
  };
}

/**
 * Fetches `systemName` and `logoUrl` from `system_config` (same source as the sidebar).
 */
export async function fetchSystemConfig() {
  const { data, error } = await supabase.from('system_config').select('*');
  if (error) {
    return mapSystemConfigRows(null);
  }
  return mapSystemConfigRows(data);
}
