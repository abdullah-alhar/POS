import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  changePasswordSchema,
  changePinSchema,
  type ChangePasswordInput,
  type AuthUser,
  type ChangePinInput,
} from '@shoppos/shared';
import { FormField } from '@/components/form-field';
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
import { AvatarPicker } from '@/components/user-avatar';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { keys } from '@/lib/queries';

export type AccountDialogMode = 'profile' | 'password' | 'pin';

export function ChangeCredentialsDialog({
  mode,
  onClose,
}: {
  mode: AccountDialogMode | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!mode} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {mode === 'profile' && <ProfilePhotoForm />}
        {mode === 'password' && <PasswordForm onDone={onClose} />}
        {mode === 'pin' && <PinForm onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const save = useMutation({
    mutationFn: (v: ChangePasswordInput) => api.post('/auth/change-password', v),
    onSuccess: () => {
      toast.success('Password changed');
      onDone();
    },
  });
  useEffect(() => form.setFocus('currentPassword'), [form]);
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Change my password</DialogTitle>
      </DialogHeader>
      <FormField label="Current password" error={e.currentPassword?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          {...form.register('currentPassword')}
        />
      </FormField>
      <FormField label="New password" error={e.newPassword?.message} hint="At least 6 characters">
        <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function PinForm({ onDone }: { onDone: () => void }) {
  const form = useForm<ChangePinInput>({
    resolver: zodResolver(changePinSchema),
    defaultValues: { currentPassword: '', newPin: '' },
  });
  const save = useMutation({
    mutationFn: (v: ChangePinInput) => api.post('/auth/change-pin', v),
    onSuccess: () => {
      toast.success('PIN changed');
      onDone();
    },
  });
  useEffect(() => form.setFocus('currentPassword'), [form]);
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Change my PIN</DialogTitle>
      </DialogHeader>
      <FormField label="Your password" error={e.currentPassword?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          {...form.register('currentPassword')}
        />
      </FormField>
      <FormField label="New PIN" error={e.newPin?.message} hint="4 to 6 digits">
        <Input
          inputMode="numeric"
          type="password"
          maxLength={6}
          autoComplete="off"
          {...form.register('newPin')}
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProfilePhotoForm() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (avatar: string | null) => api.put('/auth/me/avatar', { avatar }),
    onSuccess: (_res, avatar) => {
      qc.setQueryData<AuthUser | null>(keys.me, (old) => (old ? { ...old, avatar } : old));
      qc.invalidateQueries({ queryKey: keys.tiles });
      toast.success(avatar ? 'Photo saved' : 'Photo removed');
    },
  });
  if (!me) return null;
  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>My profile photo</DialogTitle>
        <DialogDescription>Shown on the login screen and next to your name.</DialogDescription>
      </DialogHeader>
      <AvatarPicker
        name={me.fullName}
        value={me.avatar}
        onChange={(v) => save.mutate(v)}
        busy={save.isPending}
      />
    </div>
  );
}
