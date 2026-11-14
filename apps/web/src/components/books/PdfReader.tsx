'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button, ErrorState, Skeleton } from '@/components/ui';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

/** One page at a time, rendered on demand; big prev/next buttons at the bottom for one-handed use. */
export default function PdfReader({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(320);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="flex flex-col gap-3" data-testid="pdf-reader">
      <div ref={box} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50" aria-label={title}>
        {failed ? (
          <ErrorState message="The book could not be opened. Try again." />
        ) : (
          <Document file={url} loading={<Skeleton className="h-96" />} onLoadSuccess={(d) => setPages(d.numPages)} onLoadError={() => setFailed(true)} error="">
            <Page pageNumber={page} width={width} renderTextLayer={false} renderAnnotationLayer={false} loading={<Skeleton className="h-96" />} />
          </Document>
        )}
      </div>
      <div className="sticky bottom-2 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow">
        <Button variant="secondary" className="min-w-24" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
        <span aria-live="polite" data-testid="pdf-page" className="text-base font-medium">{pages ? `Page ${page} of ${pages}` : 'Loading…'}</span>
        <Button className="min-w-24" disabled={!pages || page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</Button>
      </div>
    </div>
  );
}
