import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Manrope } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', axes: ['opsz'], display: 'swap' });
const body = Manrope({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: 'College Management System',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#003135' };
// Per-request CSP nonce (set by Express) requires dynamic rendering.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-paper text-slate-900" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
