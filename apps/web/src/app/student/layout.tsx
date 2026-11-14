'use client';

import type { ReactNode } from 'react';
import { RoleShell } from '@/components/RoleShell';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <RoleShell
      role="student"
      links={[
        { href: '/student/routine', label: 'Routine' },
        { href: '/student/attendance', label: 'Attendance' },
      ]}
    >
      {children}
    </RoleShell>
  );
}
