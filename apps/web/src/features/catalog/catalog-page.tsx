import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CornerDownRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CategoryDto } from '@marina/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { keys, useBrands, useCategories } from '@/lib/queries';

const TOP = '__top';

interface Row {
  id: string;
  name: string;
  productCount: number;
  parentId?: string | null;
}

export function CatalogPage() {
  const { data: categories = [] } = useCategories();
  const { data: brands = [] } = useBrands();
  const canEdit = useCan()('products.manage');

  return (
    <>
      <PageHeader
        title="Categories & Brands"
        description="Group products so they are easy to find and report on."
      />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <NamedList
          title="Categories"
          description="Sub-categories are allowed one level deep (e.g. Cases → iPhone cases)."
          endpoint="/categories"
          queryKey={keys.categories}
          rows={orderCategories(categories)}
          parents={categories.filter((c) => !c.parentId)}
          canEdit={canEdit}
        />
        <NamedList
          title="Brands"
          endpoint="/brands"
          queryKey={keys.brands}
          rows={brands}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}

/** Parents first, each followed by its children. */
function orderCategories(list: CategoryDto[]): Row[] {
  const parents = list.filter((c) => !c.parentId);
  return parents.flatMap((p) => [p, ...list.filter((c) => c.parentId === p.id)]);
}

function NamedList({
  title,
  description,
  endpoint,
  queryKey,
  rows,
  parents,
  canEdit,
}: {
  title: string;
  description?: string;
  endpoint: string;
  queryKey: readonly string[];
  rows: Row[];
  /** Only for categories. */
  parents?: Row[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    name: string;
    parentId: string | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const singular = title.slice(0, -1).replace(/ie$/, 'y').toLowerCase();

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: keys.products });
    toast.success(message);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post(endpoint, parents ? { name: newName, parentId: newParent } : { name: newName }),
    onSuccess: () => {
      setNewName('');
      done(`${title.slice(0, -1).replace(/ie$/, 'y')} added`);
    },
  });
  const update = useMutation({
    mutationFn: (row: { id: string; name: string; parentId: string | null }) =>
      api.patch(
        `${endpoint}/${row.id}`,
        parents ? { name: row.name, parentId: row.parentId } : { name: row.name },
      ),
    onSuccess: () => {
      setEditing(null);
      done('Saved');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${endpoint}/${id}`),
    onSuccess: () => done('Deleted'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate();
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`New ${singular} name`}
            />
            {parents && (
              <ParentSelect
                parents={parents}
                value={newParent}
                onChange={setNewParent}
                className="w-44"
              />
            )}
            <Button type="submit" disabled={!newName.trim() || create.isPending}>
              <Plus /> Add
            </Button>
          </form>
        )}

        <ul className="divide-y rounded-lg border">
          {rows.length === 0 && (
            <li className="text-muted-foreground p-4 text-sm">No {title.toLowerCase()} yet.</li>
          )}
          {rows.map((row) =>
            editing?.id === row.id ? (
              <li key={row.id} className="flex items-center gap-2 p-2">
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') update.mutate(editing);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                {parents && (
                  <ParentSelect
                    parents={parents.filter((p) => p.id !== row.id)}
                    value={editing.parentId}
                    onChange={(parentId) => setEditing({ ...editing, parentId })}
                    className="w-44"
                  />
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => update.mutate(editing)}
                  aria-label="Save"
                >
                  <Check />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                  aria-label="Cancel"
                >
                  <X />
                </Button>
              </li>
            ) : (
              <li key={row.id} className="group flex items-center gap-2 px-3 py-2">
                {row.parentId && <CornerDownRight className="text-muted-foreground ml-2 size-4" />}
                <span className="flex-1 truncate text-sm font-medium">{row.name}</span>
                <Badge variant="secondary" className="tabular-nums">
                  {row.productCount} product{row.productCount === 1 ? '' : 's'}
                </Badge>
                {canEdit && (
                  <div className="flex opacity-60 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({ id: row.id, name: row.name, parentId: row.parentId ?? null })
                      }
                      aria-label={`Rename ${row.name}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setDeleting(row)}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description={
          deleting?.productCount
            ? `It still has ${deleting.productCount} product(s). Move them first.`
            : 'This cannot be undone.'
        }
        confirmText="Delete"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

function ParentSelect({
  parents,
  value,
  onChange,
  className,
}: {
  parents: Row[];
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
}) {
  return (
    <Select value={value ?? TOP} onValueChange={(v) => onChange(v === TOP ? null : v)}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TOP}>Main category</SelectItem>
        {parents.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            Inside {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
