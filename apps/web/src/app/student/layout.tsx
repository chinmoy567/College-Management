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
        { href: '/student/live', label: 'Live' },
        { href: '/student/recordings', label: 'Recordings' },
        { href: '/student/notes', label: 'Notes' },
        { href: '/student/previous-questions', label: 'Past papers' },
        { href: '/student/exams', label: 'Exams' },
        { href: '/student/progress', label: 'Progress' },
        { href: '/feed', label: 'Feed' },
      ]}
    >
      {children}
    </RoleShell>
  );
}
