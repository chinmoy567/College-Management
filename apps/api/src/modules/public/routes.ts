import { Router } from 'express';
import { SETTING_DEFAULTS } from '@cms/shared';
import { prisma } from '../../db';
import { asyncHandler } from '../../lib/http';
import { signMany } from '../../lib/files';

export const publicCollegeRouter = Router();

/** Public college profile for the landing page (PRD 5.1): name, about, departments, contact, logo/banner. No private data. */
publicCollegeRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: 'college_profile' } });
    const p = { ...SETTING_DEFAULTS.college_profile, ...((row?.value as object | null) ?? {}) };
    const ids = [p.logoId, p.bannerId].filter((x): x is string => !!x);
    const urls = ids.length ? await signMany(ids) : new Map<string, string>();
    res.json({
      name: p.name,
      about: p.about,
      departments: p.departments,
      contact: p.contact,
      logoUrl: p.logoId ? (urls.get(p.logoId) ?? null) : null,
      bannerUrl: p.bannerId ? (urls.get(p.bannerId) ?? null) : null,
    });
  }),
);
