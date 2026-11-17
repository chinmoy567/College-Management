import { Router } from 'express';
import { z } from 'zod';
import { id } from '@cms/shared';
import { asyncHandler, validate } from '../../lib/http';
import { requireRole } from '../../middleware/session';
import { actorOf } from '../feed/common';
import { sectionOverview, sectionStudent, sectionStudents } from './service';

/** /api/mentor (03 §7a): the Section Mentor's own section only, read-only, no private student fields. */
export const mentorRouter = Router();
mentorRouter.use(requireRole('teacher'));

mentorRouter.get('/section', asyncHandler(async (req, res) => void res.json(await sectionOverview(actorOf(req).id))));
mentorRouter.get('/section/students', asyncHandler(async (req, res) => void res.json(await sectionStudents(actorOf(req).id))));
mentorRouter.get(
  '/section/students/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => void res.json(await sectionStudent(actorOf(req).id, req.params.id as string))),
);
