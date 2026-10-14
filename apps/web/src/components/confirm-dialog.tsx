import { useRef, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

/**
 * "Are you sure?" The confirm button has the focus, so Enter confirms and Esc cancels:
 * every warning can be answered from the keyboard.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirm',
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter className="items-center">
          <span className="text-muted-foreground mr-auto hidden text-xs sm:block">
            <kbd className="bg-muted rounded px-1.5 py-0.5">Enter</kbd> {confirmText.toLowerCase()}{' '}
            · <kbd className="bg-muted rounded px-1.5 py-0.5">Esc</kbd> cancel
          </span>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            className={destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
            onClick={onConfirm}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
