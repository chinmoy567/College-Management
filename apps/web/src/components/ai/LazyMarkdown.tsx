'use client';

import dynamic from 'next/dynamic';

export const LazyMarkdown = dynamic(() => import('./Markdown'), { ssr: false, loading: () => <p className="text-base text-slate-500">…</p> });
