import { useMemo, useState } from 'react';
import { Replace } from 'lucide-react';
import { applyReceiptActions } from '@shoppos/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { replaceLayout } from './actions';
import { currentDesign, useDesign } from './store';

/** Change words everywhere on the receipt at once, e.g. a new phone number (Ctrl+H). */
export function FindReplaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const design = useDesign();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const count = useMemo(() => {
    const f = find.trim().toLowerCase();
    if (!f || !design) return 0;
    return design.layout.reduce((n, e) => {
      const text =
        e.type === 'text'
          ? e.text
          : e.type === 'pair'
            ? `${e.left} ${e.right}`
            : e.type === 'qr'
              ? e.value
              : e.type === 'signature'
                ? e.label
                : '';
      return n + (text.toLowerCase().split(f).length - 1);
    }, 0);
  }, [find, design]);

  const run = () => {
    const d = currentDesign();
    const result = applyReceiptActions(d.layout, [{ op: 'replace', find: find.trim(), replace }], {
      copies: d.copies,
    });
    if (result.done.length) replaceLayout(result.done[0]!, result.layout);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (count) run();
          }}
        >
          <DialogHeader>
            <DialogTitle>Find and replace</DialogTitle>
            <DialogDescription>
              Changes the words in every text, two-column, QR and signature piece. Locked pieces are
              left as they are.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="find">Find</Label>
            <Input
              id="find"
              autoFocus
              value={find}
              maxLength={200}
              onChange={(e) => setFind(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {find.trim() ? `${count} place${count === 1 ? '' : 's'} on the receipt` : ' '}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="replace">Replace with</Label>
            <Input
              id="replace"
              value={replace}
              maxLength={200}
              onChange={(e) => setReplace(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!count}>
              <Replace /> Replace all
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
