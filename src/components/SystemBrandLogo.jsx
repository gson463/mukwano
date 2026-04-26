import { getBrandLogoUrl } from '@/lib/systemConfig';
import { cn } from '@/lib/utils';

const LOGO_ALT = 'Mukwano Financial Services — Boresha Maisha, Inuka Kiuchumi';

/**
 * Brand mark from `system_config.logoUrl`, or the official default asset when not configured.
 */
export function SystemBrandLogo({ logoUrl, className, imageClassName }) {
  const src = getBrandLogoUrl(logoUrl);

  return (
    <img
      src={src}
      alt={LOGO_ALT}
      className={cn('h-10 w-10 flex-shrink-0 object-contain p-1', imageClassName, className)}
    />
  );
}
