import { z } from 'zod';
import { ROLES } from '../enums';
import { ASSIGNABLE_PERMISSIONS } from '../permissions';
import { passwordSchema, pinSchema } from './auth';
import { imageDataUrlSchema } from './common';

/** Profile photo, shrunk to 256 px in the browser. */
export const avatarSchema = imageDataUrlSchema('Photo', 150_000).nullable();

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Use 3–32 letters, numbers, dots, dashes or underscores');

export const createUserSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(1, 'Enter the name').max(80),
  role: z.enum(ROLES),
  password: passwordSchema,
  pin: pinSchema,
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)).default([]),
  avatar: avatarSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(ROLES).optional(),
  permissions: z.array(z.enum(ASSIGNABLE_PERMISSIONS)).optional(),
  isActive: z.boolean().optional(),
  avatar: avatarSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetCredentialsSchema = z
  .object({
    password: passwordSchema.optional(),
    pin: pinSchema.optional(),
  })
  .refine((v) => v.password || v.pin, 'Enter a new password or a new PIN');
export type ResetCredentialsInput = z.infer<typeof resetCredentialsSchema>;

export const updateAvatarSchema = z.object({ avatar: avatarSchema });
export type UpdateAvatarInput = z.infer<typeof updateAvatarSchema>;
