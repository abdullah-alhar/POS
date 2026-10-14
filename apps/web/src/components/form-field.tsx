import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}
