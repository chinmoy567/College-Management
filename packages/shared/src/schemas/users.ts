import { z } from 'zod';
import { id } from './common';

const email = z.string().trim().toLowerCase().email().max(200);
const loginId = z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only');
const adminPassword = z.string().min(8).max(128);

export const studentCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  roll: z.string().trim().min(1).max(20),
  email: email.optional(), // optional: the student can add one later from their profile
  sectionId: id,
  loginId: loginId.optional(),
  password: adminPassword.optional(),
});
export const teacherCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  designation: z.string().trim().max(120).optional(),
  subjects: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  loginId: loginId.optional(),
  password: adminPassword.optional(),
});
export const userPatchBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    loginId,
    email,
    designation: z.string().trim().max(120).nullable(),
    subjects: z.array(z.string().trim().min(1).max(60)).max(20),
    nameLocked: z.boolean(),
    roll: z.string().trim().min(1).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export const resetPasswordBody = z.object({ password: adminPassword.optional() });
export const deleteUserBody = z.object({ confirmLoginId: z.string().trim().min(1) });
export const moveBody = z
  .object({ studentIds: z.array(id).min(1).max(200).optional(), wholeSectionId: id.optional(), targetSectionId: id })
  .refine((v) => !!v.studentIds !== !!v.wholeSectionId, 'Send studentIds or wholeSectionId');
export const passOutBody = z.object({ studentIds: z.array(id).min(1).max(200) });
export const teacherListQuery = z.object({ subject: z.string().trim().max(60).optional() });
export const searchQuery = z.object({ q: z.string().trim().min(1).max(100) });
export const tabQuery = z.object({
  tab: z.enum(['overview', 'academic', 'attendance', 'exams', 'community', 'books', 'activity']).default('overview'),
});
