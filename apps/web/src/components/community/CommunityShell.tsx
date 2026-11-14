'use client';

import type { ReactNode } from 'react';
import type { Me } from '@/lib/community';
import { AppShell } from '@/components/AppShell';

/** Pages shared by every role (`/feed`, `/messages`, `/notices`, `/u/[id]`) use the same app shell. */
export function CommunityShell({ children }: { children: (me: Me) => ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
