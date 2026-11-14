'use client';

import type { ReactNode } from 'react';
import { RoleShell } from '@/components/RoleShell';

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return <RoleShell role="teacher" links={[
        { href: '/teacher/attendance', label: 'Attendance' },
        { href: '/teacher/content', label: 'Content' },
        { href: '/teacher/exams', label: 'Exams' },
        { href: '/feed', label: 'Feed' },
      ]}>{children}</RoleShell>;
}
