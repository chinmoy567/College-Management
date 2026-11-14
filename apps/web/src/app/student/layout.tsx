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
        { href: '/student/exams', label: 'Exams' },
        { href: '/student/progress', label: 'Progress' },
      ]}
    >
      {children}
    </RoleShell>
  );
}
