import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** **bold** and `code` inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={i} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * An answer as the assistant writes it: paragraphs, "- " lists and **bold**. Built from React
 * elements (never as HTML), so nothing in an answer can run as code.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: { list: boolean; ordered: boolean; lines: string[] }[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ list: false, ordered: false, lines: [] });
      continue;
    }
    const list = BULLET.test(line);
    const last = blocks[blocks.length - 1];
    if (last && last.list === list && last.lines.length) last.lines.push(line);
    else blocks.push({ list, ordered: list && /^\s*\d/.test(line), lines: [line] });
  }
  return (
    <div className={cn('space-y-2 break-words', className)}>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            b.ordered ? (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(BULLET, ''))}</li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="marker:text-brand list-disc space-y-1 pl-5">
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l.replace(BULLET, ''))}</li>
                ))}
              </ul>
            )
          ) : (
            <p key={i}>
              {b.lines.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </span>
              ))}
            </p>
          ),
        )}
    </div>
  );
}

/** The answer without formatting, to copy or read aloud. */
export function plainText(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(BULLET, '');
}
