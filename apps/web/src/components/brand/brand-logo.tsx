import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';
import {
  MARINA_CELLULAR,
  MARINA_LETTERS,
  MARINA_MARK_VIEWBOX,
  MARINA_VIEWBOX,
} from './marina-paths';

/**
 * The shop logo: the uploaded one if the Super Admin set it, otherwise the built-in Marina Cellular
 * vector. The built-in logo takes its colour from `currentColor` (e.g. `text-brand`).
 */
export function BrandLogo({
  variant = 'full',
  className,
}: {
  /** full: whole logo. mark: just the "M" (built-in) or the uploaded logo. */
  variant?: 'full' | 'mark';
  className?: string;
}) {
  const branding = useBranding();
  if (branding.logo) {
    return (
      <img src={branding.logo} alt={branding.appName} className={cn('object-contain', className)} />
    );
  }
  if (variant === 'mark') {
    return (
      <svg
        viewBox={MARINA_MARK_VIEWBOX}
        fill="currentColor"
        role="img"
        aria-label={branding.appName}
        className={className}
      >
        <path d={MARINA_LETTERS[0]} />
      </svg>
    );
  }
  return (
    <svg
      viewBox={MARINA_VIEWBOX}
      fill="currentColor"
      role="img"
      aria-label={branding.appName}
      className={className}
    >
      {MARINA_LETTERS.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path d={MARINA_CELLULAR} />
    </svg>
  );
}
