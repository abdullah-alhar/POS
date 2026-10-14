import { z } from 'zod';

export const restoreBackupSchema = z.object({
  /** File name from the backup list. */
  fileName: z.string().regex(/^marina-pos_[\w-]+\.dump$/, 'Choose a backup file'),
  /** Where the file is: the backup folder on this computer, or the USB folder. */
  source: z.enum(['local', 'usb']).default('local'),
  /** The user types RESTORE to confirm. */
  confirm: z.literal('RESTORE', 'Type RESTORE to confirm'),
});
export type RestoreBackupInput = z.input<typeof restoreBackupSchema>;

export const driveConnectSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(
      /^[\w.-]+\.apps\.googleusercontent\.com$/,
      'Paste the Client ID (ends with .apps.googleusercontent.com)',
    ),
  clientSecret: z.string().trim().min(10, 'Paste the Client secret').max(200),
});
export type DriveConnectInput = z.infer<typeof driveConnectSchema>;
