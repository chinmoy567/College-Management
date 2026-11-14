import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { deleteUserBody, id, moveBody, passOutBody, resetPasswordBody, studentCreateBody, teacherCreateBody, teacherListQuery, userPatchBody } from '@cms/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { AppError, asyncHandler, validate } from '../../lib/http';
import { logger } from '../../lib/logger';
import { generatePassword } from '../../lib/passwordGen';
import { permissionsFor } from '../../lib/permissions';
import { type AuthedRequest, requireRole } from '../../middleware/session';
import { sendVerification } from '../auth/routes';
import { ImportInvalid, dryRunStudents, dryRunTeachers, importStudents, importTeachers } from './importCsv';
import { passOutStudents } from './passOut';
import { anonymise, createStudent, createTeacher, deactivate, editUser, moveStudents, reactivate, resetPassword, type UserPatch } from './service';
import { stashSlips, takeSlips } from './slips';

export const usersRouter = Router();
const idParam = z.object({ id });
const ip = (req: Request) => req.ip ?? undefined;
const actorOf = (req: Request) => (req as AuthedRequest).actor;
const admin = requireRole('admin');
const noStore = (res: Response) => res.set('Cache-Control', 'no-store');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const csvUpload = (req: Request, res: Response, next: (e?: unknown) => void) =>
  upload.single('file')(req, res, (e: unknown) => {
    if (e) return next(new AppError('VALIDATION_ERROR', 400, 'Upload one CSV file of at most 2 MB.', { file: 'upload' }));
    if (!req.file) return next(new AppError('VALIDATION_ERROR', 400, 'Choose a CSV file.', { file: 'required' }));
    next();
  });

// ───── create ─────
usersRouter.post(
  '/students',
  admin,
  validate({ body: studentCreateBody }),
  asyncHandler(async (req, res) => {
    const out = await createStudent(actorOf(req).id, req.body as z.infer<typeof studentCreateBody>, ip(req));
    noStore(res).status(201).json(out); // the plain password is returned here once (PRD §4.4)
  }),
);
usersRouter.post(
  '/teachers',
  admin,
  validate({ body: teacherCreateBody }),
  asyncHandler(async (req, res) => {
    const out = await createTeacher(actorOf(req).id, req.body as z.infer<typeof teacherCreateBody>, ip(req));
    noStore(res).status(201).json(out);
  }),
);
usersRouter.post('/generate-password', admin, (_req, res) => void noStore(res).json({ password: generatePassword() }));

usersRouter.get(
  '/teachers',
  admin,
  validate({ query: teacherListQuery }),
  asyncHandler(async (req, res) => {
    const { subject } = req.query as { subject?: string };
    const s = subject ?? '';
    // Teachers whose subjects match come first (PRD §3.3), then by name.
    const items = await prisma.$queryRaw<{ id: string; name: string; designation: string | null; subjects: string[]; loginId: string | null; matches: boolean }[]>(Prisma.sql`
      SELECT u.id, tp.name, tp.designation, tp.subjects, u.login_id AS "loginId",
             EXISTS (SELECT 1 FROM unnest(tp.subjects) x WHERE lower(x) = lower(${s}) AND ${s} <> '') AS matches
      FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id
      WHERE u.role = 'teacher' AND u.status = 'active'
      ORDER BY matches DESC, tp.name ASC`);
    res.json({ items });
  }),
);

// ───── CSV import ─────
function importError(res: Response, e: unknown): boolean {
  if (!(e instanceof ImportInvalid)) return false;
  res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Nothing was imported. Fix the rows below and upload again.' }, errors: e.errors });
  return true;
}
function importRoute(kind: 'students' | 'teachers') {
  return asyncHandler(async (req, res) => {
    const buf = (req as Request & { file: { buffer: Buffer } }).file.buffer;
    const dry = req.query.dryRun === 'true';
    try {
      if (dry) return void res.json(await (kind === 'students' ? dryRunStudents(buf) : dryRunTeachers(buf)));
      const out = await (kind === 'students' ? importStudents : importTeachers)(actorOf(req).id, buf, ip(req));
      const { token, expiresAt } = stashSlips(actorOf(req).id, out.slips);
      noStore(res).status(201).json({ created: out.created, slipToken: token, slipsExpireAt: expiresAt });
    } catch (e) {
      if (!importError(res, e)) throw e;
    }
  });
}
usersRouter.post('/import/students', admin, csvUpload, importRoute('students'));
usersRouter.post('/import/teachers', admin, csvUpload, importRoute('teachers'));
usersRouter.get(
  '/import/slips/:token',
  admin,
  validate({ params: z.object({ token: z.string().min(10).max(100) }), query: z.object({ format: z.enum(['pdf', 'csv']) }) }),
  asyncHandler(async (req, res) => {
    const { token } = req.params as { token: string };
    const { format } = req.query as { format: 'pdf' | 'csv' };
    const body = await takeSlips(actorOf(req).id, token, format);
    if (!body) throw new AppError('NOT_FOUND', 404, 'This download is no longer available.');
    noStore(res)
      .type(format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="credential-slips.${format}"`)
      .send(body);
  }),
);

// ───── move, promote, pass-out ─────
usersRouter.post(
  '/students/move',
  admin,
  validate({ body: moveBody }),
  asyncHandler(async (req, res) => {
    res.json(await moveStudents(actorOf(req).id, req.body as z.infer<typeof moveBody>, ip(req)));
  }),
);
usersRouter.post(
  '/students/pass-out',
  admin,
  validate({ body: passOutBody }),
  asyncHandler(async (req, res) => {
    res.json(await passOutStudents(actorOf(req).id, (req.body as z.infer<typeof passOutBody>).studentIds, ip(req)));
  }),
);

// ───── teacher / mentor limited student view (PRD §5.3.1, §8 Privacy) ─────
/** The only serializer for a student shown to teachers and mentors: no mobile, address, DOB or guardian. */
export function serializeStudentLimited(s: {
  userId: string;
  name: string;
  roll: string;
  user: { loginId: string | null; avatarId: string | null; status: string };
  section: { id: string; name: string; classLevel: number; group: { type: string; session: { name: string } } };
  enrollments: { courseOfferingId: string; courseOffering: { course: { id: string; code: string; name: string }; teacher: { name: string } } }[];
}) {
  return {
    id: s.userId,
    name: s.name,
    avatarId: s.user.avatarId,
    loginId: s.user.loginId,
    roll: s.roll,
    status: s.user.status,
    section: { id: s.section.id, name: s.section.name, classLevel: s.section.classLevel, group: s.section.group.type, session: s.section.group.session.name },
    courses: s.enrollments.map((e) => ({
      offeringId: e.courseOfferingId,
      courseId: e.courseOffering.course.id,
      code: e.courseOffering.course.code,
      name: e.courseOffering.course.name,
      teacher: e.courseOffering.teacher.name,
    })),
  };
}

usersRouter.get(
  '/students/:id',
  requireRole('admin', 'teacher'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id: sid } = req.params as { id: string };
    const actor = actorOf(req);
    const s = await prisma.studentProfile.findFirst({
      where: { userId: sid, user: { status: { not: 'deleted' } } },
      select: {
        userId: true, name: true, roll: true,
        user: { select: { loginId: true, avatarId: true, status: true } },
        section: { select: { id: true, name: true, classLevel: true, group: { select: { type: true, session: { select: { name: true } } } } } },
        enrollments: {
          where: { status: 'active' },
          select: { courseOfferingId: true, courseOffering: { select: { teacherId: true, course: { select: { id: true, code: true, name: true } }, teacher: { select: { name: true } } } } },
        },
      },
    });
    if (!s) throw new AppError('NOT_FOUND', 404, 'Student not found.');
    let scoped = s.enrollments;
    if (actor.role === 'teacher') {
      const mentor = await permissionsFor(req).mentorsSection(actor, s.section.id);
      scoped = mentor ? s.enrollments : s.enrollments.filter((e) => e.courseOffering.teacherId === actor.id);
      if (!mentor && scoped.length === 0) throw new AppError('NOT_FOUND', 404, 'Student not found.');
    }
    res.json(serializeStudentLimited({ ...s, enrollments: scoped }));
  }),
);

// ───── edit, reset, status, delete ─────
usersRouter.patch(
  '/:id',
  admin,
  validate({ params: idParam, body: userPatchBody }),
  asyncHandler(async (req, res) => {
    const { id: uid } = req.params as { id: string };
    const r = await editUser(actorOf(req).id, uid, req.body as UserPatch, ip(req));
    if (r.emailChanged) {
      // The edit is already saved; a mail-queue hiccup must not turn it into an error. The Admin can resend later.
      await sendVerification({ id: uid, email: r.email }).catch((e: unknown) => logger.warn({ err: e }, 'verification email not queued'));
    }
    res.json({ ok: true, emailChanged: r.emailChanged });
  }),
);
usersRouter.post(
  '/:id/reset-password',
  admin,
  validate({ params: idParam, body: resetPasswordBody }),
  asyncHandler(async (req, res) => {
    const { id: uid } = req.params as { id: string };
    const password = await resetPassword(actorOf(req).id, uid, (req.body as { password?: string }).password, ip(req));
    noStore(res).json({ password }); // shown once for the slip, never stored or emailed
  }),
);
usersRouter.post(
  '/:id/deactivate',
  admin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await deactivate(actorOf(req).id, (req.params as { id: string }).id, ip(req));
    res.json({ ok: true });
  }),
);
usersRouter.post(
  '/:id/reactivate',
  admin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await reactivate(actorOf(req).id, (req.params as { id: string }).id, ip(req));
    res.json({ ok: true });
  }),
);
usersRouter.delete(
  '/:id',
  admin,
  validate({ params: idParam, body: deleteUserBody }),
  asyncHandler(async (req, res) => {
    await anonymise(actorOf(req).id, (req.params as { id: string }).id, (req.body as { confirmLoginId: string }).confirmLoginId, ip(req));
    res.json({ ok: true });
  }),
);
