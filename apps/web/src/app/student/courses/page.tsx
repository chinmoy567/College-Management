'use client';

import { PageTitle } from '@/components/ui';
import { Tiles } from '@/components/Dashboard';

export default function StudentCourses() {
  return (
    <>
      <PageTitle>Courses</PageTitle>
      <Tiles
        items={[
          { href: '/student/live', label: 'Live classes', icon: '🎥' },
          { href: '/student/recordings', label: 'Recordings', icon: '▶️' },
          { href: '/student/notes', label: 'Notes', icon: '📄' },
          { href: '/student/previous-questions', label: 'Previous questions', icon: '🗃️' },
          { href: '/student/exams', label: 'Exams', icon: '📝' },
          { href: '/student/progress', label: 'Results', icon: '📈' },
        ]}
      />
    </>
  );
}
