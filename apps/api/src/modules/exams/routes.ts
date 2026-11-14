import { Router } from 'express';
import { bankRouter } from './bank';
import { attemptsRouter, startRouter } from './attempts';
import { changesRouter, extendRouter } from './changes';
import { lifecycleRouter } from './lifecycle';
import { meRouter } from './progress';
import { offeringProgressRouter, reportRouter } from './reports';

/** /api/exams (05). Fixed paths are mounted before `/:id` so `bank`, `me`, `attempts`, `offerings` are never read as an id. */
export const examsRouter = Router();
examsRouter.use('/bank', bankRouter);
examsRouter.use('/me', meRouter);
examsRouter.use('/attempts', attemptsRouter);
examsRouter.use('/attempts', extendRouter);
examsRouter.use('/offerings', offeringProgressRouter);
examsRouter.use(reportRouter);
examsRouter.use(changesRouter);
examsRouter.use(startRouter);
examsRouter.use(lifecycleRouter);

export { adminExamsRouter } from './reports';
