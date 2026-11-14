import { z } from 'zod';

export const BD_MOBILE = /^01[3-9]\d{8}$/;
export const normaliseMobile = (v: string): string => v.replace(/[\s-]/g, '').replace(/^\+?880/, '0');

export const mobile = z
  .string()
  .trim()
  .transform(normaliseMobile)
  .refine((v) => BD_MOBILE.test(v), 'Enter a valid Bangladesh mobile number (01XXXXXXXXX)');

export const newPassword = z.string().min(8, 'At least 8 characters').max(128);

export const loginBody = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
  roleHint: z.enum(['admin', 'teacher', 'student']).optional(),
});
export const totpCodeBody = z.union([
  z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }),
  z.object({ backupCode: z.string().trim().min(10).max(11) }),
]);
export const totpEnableBody = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
export const regenerateBody = z.object({ password: z.string().min(1), code: z.string().trim().regex(/^\d{6}$/) });
export const forgotBody = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetBody = z.object({ token: z.string().min(10).max(100), newPassword });
export const adminChangePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword });
export const completeProfileBody = z.object({ newPassword, mobile });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword });
export const changeEmailBody = z.object({ newEmail: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

// Profile edit matrix (02 §7): read-only fields are simply absent, so Zod strips them.
export const studentProfileUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    mobile,
    bio: z.string().trim().max(500).nullable(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    address: z.string().trim().max(300).nullable(),
    guardianName: z.string().trim().max(100).nullable(),
    guardianContact: z.string().trim().max(50).nullable(),
  })
  .partial();
export const teacherProfileUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    mobile,
    bio: z.string().trim().max(500).nullable(),
  })
  .partial();
