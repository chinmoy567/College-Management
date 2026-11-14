import { Router } from 'express';
import { catalogRouter } from './catalog';
import { offeringsRouter } from './offerings';
import { sessionsRouter } from './sessions';

/** /api/academics: sessions, groups, sections, mentor, catalog, chapters, offerings (03 §1-4). */
export const academicsRouter = Router();
academicsRouter.use(sessionsRouter);
academicsRouter.use(catalogRouter);
academicsRouter.use(offeringsRouter);
