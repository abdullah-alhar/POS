import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type ControlProps = {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

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
  const auto = useId();
  const noteId = `${auto}-note`;
  const note = error || hint ? noteId : undefined;
  // A single input inside the field gets the label's id, so clicking the label
  // focuses it and screen readers read the label, error and hint with it.
  let control = children;
  let id = htmlFor;
  if (!id && isValidElement<ControlProps>(children) && typeof children.type !== 'symbol') {
    id = children.props.id ?? auto;
    control = cloneElement(children as ReactElement<ControlProps>, {
      id,
      ...(error && { 'aria-invalid': true }),
      ...(note && { 'aria-describedby': note }),
    });
  }
  return (
    <div className={cn('grid gap-1.5', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {control}
      {error ? (
        <p id={noteId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
