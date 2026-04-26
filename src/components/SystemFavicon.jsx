import { useEffect } from 'react';
import { fetchSystemConfig, getBrandLogoUrl } from '@/lib/systemConfig';

/**
 * Sets document favicon from the same resolved logo as the sidebar (config or default asset).
 */
export function SystemFavicon() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { logoUrl } = await fetchSystemConfig();
        if (cancelled) return;
        const u = getBrandLogoUrl(logoUrl);
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
          link = document.createElement('link');
          link.setAttribute('rel', 'icon');
          document.head.appendChild(link);
        }
        link.href = u;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
