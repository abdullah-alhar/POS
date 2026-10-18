import { Fragment, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import type { AuditEntryDto, Page, UserDto } from '@shoppos/shared';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { addDays, localDate } from '@/lib/dates';
import { useCan } from '@/lib/auth';

const present = (v: unknown) => v !== null && v !== undefined;

/** "SALE_VOID" → "Sale void" */
const actionLabel = (a: string) => a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ');

const TONE: Record<string, 'destructive' | 'warning' | 'success' | 'secondary'> = {
  SALE_VOID: 'destructive',
  LOGIN_FAILED: 'destructive',
  BACKUP_RESTORE: 'destructive',
  STOCK_ADJUST: 'warning',
  PRICE_CHANGE: 'warning',
  SETTINGS_UPDATE: 'warning',
  USER_UPDATE: 'warning',
  RETURN_CREATE: 'warning',
  CASH_OUT: 'warning',
  SALE_CREATE: 'success',
};

export function AuditPage() {
  const can = useCan();
  const [from, setFrom] = useState(addDays(localDate(), -6));
  const [to, setTo] = useState(localDate());
  const [userId, setUserId] = useState('all');
  const [action, setAction] = useState('all');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data: actions = [] } = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: () => api.get<string[]>('/audit/actions'),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserDto[]>('/users'),
    enabled: can('users.manage'),
  });
  const query = {
    from: from || undefined,
    to: to || undefined,
    userId: userId === 'all' ? undefined : userId,
    action: action === 'all' ? undefined : action,
    q: q || undefined,
    page,
    pageSize: 50,
  };
  const { data, isPending } = useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.get<Page<AuditEntryDto>>(`/audit${qs(query)}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Everything important that happened, who did it and who approved it. It cannot be changed."
      />
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">From</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => (setFrom(e.target.value), setPage(1))}
              className="w-40"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">To</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => (setTo(e.target.value), setPage(1))}
              className="w-40"
            />
          </label>
          {users.length > 0 && (
            <Select value={userId} onValueChange={(v) => (setUserId(v), setPage(1))}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={action} onValueChange={(v) => (setAction(v), setPage(1))}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search text"
            className="max-w-xs"
          />
        </div>
        {!isPending && !data?.total ? (
          <EmptyState
            icon={ScrollText}
            title="Nothing found"
            description="Try other dates or filters."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>What happened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((e) => {
                const hasDetails = present(e.before) || present(e.after) || present(e.meta);
                const isOpen = open === e.id;
                return (
                  <Fragment key={e.id}>
                    <TableRow
                      className={hasDetails ? 'cursor-pointer' : undefined}
                      onClick={() => hasDetails && setOpen(isOpen ? null : e.id)}
                    >
                      <TableCell className="text-muted-foreground">
                        {hasDetails &&
                          (isOpen ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          ))}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {e.userName ?? 'System'}
                        {e.approvedByName && (
                          <span className="text-muted-foreground block text-xs">
                            approved by {e.approvedByName}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TONE[e.action] ?? 'secondary'}>
                          {actionLabel(e.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xl text-sm whitespace-normal">
                        {e.summary ?? '—'}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell />
                        <TableCell colSpan={4}>
                          <div className="grid gap-3 md:grid-cols-3">
                            {(['before', 'after', 'meta'] as const).map((k) =>
                              !present(e[k]) ? null : (
                                <div key={k}>
                                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                                    {k === 'meta' ? 'Details' : k}
                                  </p>
                                  <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
                                    {JSON.stringify(e[k], null, 2)}
                                  </pre>
                                </div>
                              ),
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
