import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import { LOGO_MARK, LOGO_MARK_VIEWBOX, LOGO_VIEWBOX, LOGO_WORDMARK } from './logo-paths';

/**
 * The shop logo: the uploaded one if the Super Admin set it, otherwise the built-in ShopPOS
 * vector. The built-in logo takes its colour from `currentColor` (e.g. `text-brand`).
 */
export function BrandLogo({
  variant = 'full',
  className,
}: {
  /** full: whole logo. mark: just the bag (built-in) or the uploaded logo. */
  variant?: 'full' | 'mark';
  className?: string;
}) {
  const branding = useBranding();
  if (branding.logo) {
    return (
      <img src={branding.logo} alt={branding.appName} className={cn('object-contain', className)} />
    );
  }
  const paths = variant === 'mark' ? LOGO_MARK : [...LOGO_MARK, ...LOGO_WORDMARK];
  return (
    <svg
      viewBox={variant === 'mark' ? LOGO_MARK_VIEWBOX : LOGO_VIEWBOX}
      fill="currentColor"
      fillRule="evenodd"
      role="img"
      aria-label={branding.appName}
      className={className}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
