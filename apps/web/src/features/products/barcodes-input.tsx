import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/lib/api';

/**
 * A list of barcodes. Scan or type a code and press Enter to add it,
 * or press the sparkle button to create an in-store barcode.
 */
export function BarcodesInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const [text, setText] = useState('');
  const generate = useMutation({
    mutationFn: () => api.post<{ codes: string[] }>('/barcodes/generate', { count: 1 }),
    onSuccess: ({ codes }) => onChange([...value, ...codes]),
  });

  function add() {
    const code = text.trim();
    if (code && !value.includes(code)) onChange([...value, code]);
    setText('');
  }

  return (
    <div className="w-48 space-y-1.5">
      <div className="flex gap-1">
        <Input
          value={text}
          placeholder="Scan or type"
          className="font-mono text-xs"
          onChange={(e) => setText(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            // Scanners press Enter after the code: add it instead of saving the form.
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
              aria-label="Create a barcode"
            >
              {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create an in-store barcode</TooltipContent>
        </Tooltip>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((code) => (
            <span
              key={code}
              className="bg-secondary inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]"
            >
              {code}
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== code))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${code}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
