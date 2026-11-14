'use client';

import { PageTitle } from '@/components/ui';
import { Section, TodayWidget, Tiles } from '@/components/Dashboard';
import { useMeUser } from '@/components/AppShell';

export default function StudentHome() {
  const me = useMeUser().data?.user;
  return (
    <>
      <PageTitle>Hello{me ? `, ${me.name.split(' ')[0]}` : ''}</PageTitle>
      <TodayWidget href="/student/routine" />
      <Section title="Quick links">
        <Tiles
          items={[
            { href: '/student/exams', label: 'Exams', icon: '📝', hint: 'Upcoming and results' },
            { href: '/student/attendance', label: 'Attendance', icon: '✅' },
            { href: '/student/progress', label: 'Progress', icon: '📈' },
            { href: '/notices', label: 'Notices', icon: '📢' },
            { href: '/feed', label: 'Pinned and feed', icon: '📰', hint: 'Announcements and posts' },
          ]}
        />
      </Section>
    </>
  );
}
