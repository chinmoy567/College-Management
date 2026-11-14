import { registerJob } from '../../jobs';
import { makePreview } from './service';

/** `book.make_preview` (09 section 1.1). Handlers run one at a time per worker, which keeps RAM low for big PDFs. */
export async function registerBookJobs(): Promise<void> {
  await registerJob<{ bookId: string }>('book.make_preview', (d) => makePreview(d.bookId));
}
