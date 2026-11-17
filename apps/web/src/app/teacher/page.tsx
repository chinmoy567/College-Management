'use client';

import { PageTitle } from '@/components/ui';
import { Section, TodayWidget, Tiles } from '@/components/Dashboard';
import { useMeUser } from '@/components/AppShell';

export default function TeacherHome() {
  const me = useMeUser().data?.user;
  return (
    <>
      <PageTitle>Hello{me ? `, ${me.name.split(' ')[0]}` : ''}</PageTitle>
      <TodayWidget href="/teacher/attendance" />
      <Section title="Work">
        <Tiles
          items={[
            { href: '/teacher/routine', label: 'My routine', icon: '🕒', hint: 'Week, and take attendance' },
            { href: '/teacher/attendance', label: 'Take attendance', icon: '✅' },
            { href: '/teacher/content', label: 'My courses', icon: '📚', hint: 'Classes, recordings, notes' },
            { href: '/teacher/exams', label: 'Exams', icon: '📝' },
            { href: '/notices/new', label: 'New notice', icon: '📢' },
            ...(me?.isMentorOf ? [{ href: '/teacher/section', label: 'My Section', icon: '🧭', hint: 'Students, attendance, results' }] : []),
          ]}
        />
      </Section>
    </>
  );
}
