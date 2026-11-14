import { Router } from 'express';
import { engageRouter } from './engage';
import { feedRouter } from './feed';
import { postsRouter } from './posts';

/** /api/feed (06). `GET /` and the fixed paths in feedRouter come before the id routes. */
export const communityRouter = Router();
communityRouter.use(feedRouter);
communityRouter.use(postsRouter);
communityRouter.use(engageRouter);

export { publicProfileRouter } from './profile';
export { moderationRouter, reportsRouter, purgeRemovedContent } from './moderation';
