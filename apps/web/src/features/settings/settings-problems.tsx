import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { ProblemDto } from '@shoppos/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

/**
 * Unexpected errors since the POS started, newest first. Each error message on the screen shows
 * its code and reference; find it here to see what happened, or send it to support.
 */
export function SettingsProblems() {
  const {
    data = [],
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['system-problems'],
    queryFn: () => api.get<ProblemDto[]>('/system/problems'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Problems</CardTitle>
        <CardDescription>
          When something goes wrong, the message shows a code and a reference (for example "Ref
          E7K3F9"). Find it here. The full details are also in the server log.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={isFetching ? 'animate-spin' : undefined} /> Refresh
          </Button>
        </div>
        {data.length === 0 ? (
          <p className="text-success flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-5" /> No problems since the POS started.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.map((p) => (
              <li key={p.ref} className="grid gap-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="font-mono">
                    {p.ref}
                  </Badge>
                  <Badge variant="secondary" className="font-mono">
                    {p.code}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {new Date(p.at).toLocaleString('en-GB')} · {p.method} {p.path}
                    {p.user && ` · ${p.user}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(`${p.ref} ${p.code} ${p.at} ${p.method} ${p.path}\n${p.detail}`)
                        .then(() => toast.success('Copied'))
                    }
                  >
                    <Copy /> Copy
                  </Button>
                </div>
                <p>{p.message}</p>
                <pre className="bg-muted text-muted-foreground max-h-32 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
                  {p.detail}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
