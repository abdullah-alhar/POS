import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, KeyRound, Pencil, Plus, ShieldCheck, Users } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ASSIGNABLE_PERMISSIONS,
  avatarSchema,
  createUserSchema,
  DEFAULT_CASHIER_PERMISSIONS,
  isAdminRole,
  passwordSchema,
  PERMISSIONS,
  pinSchema,
  ROLE_LABELS,
  ROLES,
  type CreateUserInput,
  type Permission,
  type Role,
  type UserDto,
} from '@marina/shared';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AvatarPicker, UserAvatar } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { keys } from '@/lib/queries';

type DialogState = { mode: 'create' } | { mode: 'edit' | 'reset'; user: UserDto } | null;

export function UsersPage() {
  const { data: users = [], isPending } = useQuery({
    queryKey: keys.users,
    queryFn: () => api.get<UserDto[]>('/users'),
  });
  const [dialog, setDialog] = useState<DialogState>(null);

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can use the POS, and what they are allowed to do."
        actions={
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus /> Add user
          </Button>
        }
      />
      <Card className="gap-0 py-0">
        {users.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.fullName} src={u.avatar} />
                      <div>
                        <p className="font-medium">{u.fullName}</p>
                        <p className="text-muted-foreground text-xs">@{u.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={u.role} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                  </TableCell>
                  <TableCell>
                    {u.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ mode: 'edit', user: u })}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ mode: 'reset', user: u })}
                    >
                      <KeyRound /> Password / PIN
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isPending && !users.some((u) => u.role === 'CASHIER') && (
          <div className="border-t">
            <EmptyState
              icon={Users}
              title="No cashiers yet"
              description="Give each cashier their own PIN, so every bill shows who made it."
              action={
                <Button variant="outline" onClick={() => setDialog({ mode: 'create' })}>
                  <Plus /> Add a cashier
                </Button>
              }
            />
          </div>
        )}
      </Card>

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-xl">
          {dialog?.mode === 'create' && <CreateUserForm onDone={() => setDialog(null)} />}
          {dialog?.mode === 'edit' && (
            <EditUserForm user={dialog.user} onDone={() => setDialog(null)} />
          )}
          {dialog?.mode === 'reset' && (
            <ResetForm user={dialog.user} onDone={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === 'SUPER_ADMIN') {
    return (
      <Badge className="bg-foreground text-background">
        <Crown /> Super Admin
      </Badge>
    );
  }
  if (role === 'ADMIN') {
    return (
      <Badge>
        <ShieldCheck /> Admin
      </Badge>
    );
  }
  return <Badge variant="secondary">Cashier</Badge>;
}

/** Roles this user may hand out: only the Super Admin can make another Super Admin. */
function useGrantableRoles(): Role[] {
  const { data: me } = useMe();
  return ROLES.filter((r) => r !== 'SUPER_ADMIN' || me?.role === 'SUPER_ADMIN');
}

function useSaved(message: string, onDone: () => void) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.users });
    qc.invalidateQueries({ queryKey: keys.tiles });
    qc.invalidateQueries({ queryKey: keys.me });
    toast.success(message);
    onDone();
  };
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const roles = useGrantableRoles();
  const form = useForm<z.input<typeof createUserSchema>, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: '',
      fullName: '',
      role: 'CASHIER',
      password: '',
      pin: '',
      permissions: DEFAULT_CASHIER_PERMISSIONS,
      avatar: null,
    },
  });
  const saved = useSaved('User added', onDone);
  const save = useMutation({
    mutationFn: (v: CreateUserInput) => api.post('/users', v),
    onSuccess: saved,
  });
  const e = form.formState.errors;
  const [role, fullName] = useWatch({ control: form.control, name: ['role', 'fullName'] });

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add user</DialogTitle>
      </DialogHeader>
      <Controller
        control={form.control}
        name="avatar"
        render={({ field }) => (
          <AvatarPicker name={fullName} value={field.value} onChange={field.onChange} />
        )}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Full name" error={e.fullName?.message}>
          <Input autoFocus {...form.register('fullName')} />
        </FormField>
        <FormField label="Username" error={e.username?.message}>
          <Input autoCapitalize="none" {...form.register('username')} />
        </FormField>
        <FormField label="Password" error={e.password?.message} hint="For the username login">
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <FormField label="PIN" error={e.pin?.message} hint="4–6 digits, for quick login">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            {...form.register('pin')}
          />
        </FormField>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <RoleSelect roles={roles} value={field.value} onChange={field.onChange} />
          )}
        />
      </div>
      {!isAdminRole(role) && (
        <Controller
          control={form.control}
          name="permissions"
          render={({ field }) => (
            <PermissionsField value={field.value ?? []} onChange={field.onChange} />
          )}
        />
      )}
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Add user
        </Button>
      </DialogFooter>
    </form>
  );
}

const editSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the name').max(80),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)),
  isActive: z.boolean(),
  avatar: avatarSchema,
});
type EditValues = z.infer<typeof editSchema>;

function EditUserForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const { data: me } = useMe();
  const roles = useGrantableRoles();
  const isSelf = me?.id === user.id;
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fullName: user.fullName,
      role: user.role,
      permissions: isAdminRole(user.role)
        ? DEFAULT_CASHIER_PERMISSIONS
        : user.permissions.filter((p) => ASSIGNABLE_PERMISSIONS.includes(p)),
      isActive: user.isActive,
      avatar: user.avatar,
    },
  });
  const saved = useSaved('User saved', onDone);
  const save = useMutation({
    mutationFn: (v: EditValues) => api.patch(`/users/${user.id}`, v),
    onSuccess: saved,
  });
  const [role, fullName] = useWatch({ control: form.control, name: ['role', 'fullName'] });

  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Edit {user.fullName}</DialogTitle>
        <DialogDescription>@{user.username}</DialogDescription>
      </DialogHeader>
      <Controller
        control={form.control}
        name="avatar"
        render={({ field }) => (
          <AvatarPicker name={fullName} value={field.value} onChange={field.onChange} />
        )}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Full name" error={form.formState.errors.fullName?.message}>
          <Input {...form.register('fullName')} />
        </FormField>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <RoleSelect
              roles={roles}
              value={field.value}
              onChange={field.onChange}
              disabled={isSelf}
            />
          )}
        />
      </div>
      {!isAdminRole(role) && (
        <Controller
          control={form.control}
          name="permissions"
          render={({ field }) => <PermissionsField value={field.value} onChange={field.onChange} />}
        />
      )}
      <Controller
        control={form.control}
        name="isActive"
        render={({ field }) => (
          <div className="flex items-center gap-3">
            <Switch
              id="active"
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={isSelf}
            />
            <Label htmlFor="active">Can log in</Label>
          </div>
        )}
      />
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

const resetSchema = z
  .object({
    password: z.union([z.literal(''), passwordSchema]),
    pin: z.union([z.literal(''), pinSchema]),
  })
  .refine((v) => v.password || v.pin, {
    message: 'Enter a new password or a new PIN',
    path: ['pin'],
  });
type ResetValues = z.infer<typeof resetSchema>;

function ResetForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', pin: '' },
  });
  const save = useMutation({
    mutationFn: (v: ResetValues) =>
      api.post(`/users/${user.id}/reset-credentials`, {
        password: v.password || undefined,
        pin: v.pin || undefined,
      }),
    onSuccess: () => {
      toast.success('Saved');
      onDone();
    },
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New password or PIN for {user.fullName}</DialogTitle>
        <DialogDescription>Leave a box empty to keep the current one.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="New password" error={e.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <FormField label="New PIN" error={e.pin?.message}>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            {...form.register('pin')}
          />
        </FormField>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

const ROLE_HINTS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin: everything, including branding',
  ADMIN: 'Admin: shop owner, everything except branding',
  CASHIER: 'Cashier: only the ticked permissions',
};

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: Role[];
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <FormField label="Role">
      <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
        <SelectTrigger>
          <SelectValue>{ROLE_LABELS[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {[...roles].reverse().map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_HINTS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

function PermissionsField({
  value,
  onChange,
}: {
  value: Permission[];
  onChange: (permissions: Permission[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">This cashier can</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border p-3">
        {ASSIGNABLE_PERMISSIONS.map((p) => (
          <label key={p} className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={value.includes(p)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...value, p] : value.filter((x) => x !== p))
              }
            />
            {PERMISSIONS[p]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
