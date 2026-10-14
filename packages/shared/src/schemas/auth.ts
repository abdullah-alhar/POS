import { z } from 'zod';
import { ALL_APPROVAL_ACTIONS } from '../permissions';

export const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
export const passwordSchema = z.string().min(6, 'Password must be at least 6 characters').max(128);

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const pinLoginSchema = z.object({
  userId: z.uuid(),
  pin: pinSchema,
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

export const approveSchema = z.object({
  action: z.enum(ALL_APPROVAL_ACTIONS),
  pin: pinSchema,
  /** What is being approved, e.g. "Price of Anker 20W charger 4500 → 3900". Saved in the audit log. */
  note: z.string().max(300).optional(),
});
export type ApproveInput = z.infer<typeof approveSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changePinSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your password'),
  newPin: pinSchema,
});
export type ChangePinInput = z.infer<typeof changePinSchema>;
