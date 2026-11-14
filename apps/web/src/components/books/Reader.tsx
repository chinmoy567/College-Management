'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui';

/** react-pdf and pdf.js load only when a book is opened (phones, free tier). */
export const Reader = dynamic(() => import('./PdfReader'), { ssr: false, loading: () => <Skeleton className="h-96" /> });
