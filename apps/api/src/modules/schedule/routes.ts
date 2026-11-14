import { Router } from 'express';
import { calendarRouter } from './calendar';
import { routineRouter } from './routine';
import { setupRouter } from './setup';
import { viewsRouter } from './views';

/** /api/schedule (04 §1-3, §8). Every route sits behind the session chain; writes check Admin per route. */
export const scheduleRouter = Router();
scheduleRouter.use(viewsRouter); // /me/* first so it never collides with /:id routes
scheduleRouter.use(setupRouter);
scheduleRouter.use(routineRouter);
scheduleRouter.use(calendarRouter);
