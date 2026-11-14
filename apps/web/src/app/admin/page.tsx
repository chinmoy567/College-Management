'use client';

import { PageTitle } from '@/components/ui';
import { Section, Tiles } from '@/components/Dashboard';

export default function AdminHome() {
  return (
    <>
      <PageTitle>Dashboard</PageTitle>
      <Section title="Quick actions">
        <Tiles
          items={[
            { href: '/admin/students/new', label: 'Add student', icon: '➕' },
            { href: '/admin/students/import', label: 'Import CSV', icon: '📥' },
            { href: '/admin/sessions', label: 'Sessions', icon: '🏫', hint: 'Groups and sections' },
            { href: '/admin/schedule', label: 'Schedule', icon: '🗓️' },
            { href: '/admin/mentors', label: 'Mentors', icon: '🧭', hint: 'Sections without one' },
            { href: '/admin/moderation', label: 'Moderation', icon: '🛡️', hint: 'Reported content' },
          ]}
        />
      </Section>
    </>
  );
}
