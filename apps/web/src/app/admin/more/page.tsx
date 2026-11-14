import Link from 'next/link';
import { Card, PageTitle } from '@/components/ui';

const links = [
  { href: '/admin/mentors', label: 'Section Mentors', hint: 'Sections without a mentor' },
  { href: '/admin/students/new', label: 'Add student', hint: 'One student with a credential slip' },
  { href: '/admin/students/import', label: 'Import students (CSV)', hint: 'Dry run first, then import' },
];

export default function More() {
  return (
    <>
      <PageTitle>More</PageTitle>
      <div className="flex flex-col gap-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="min-h-11">
              <p className="text-lg font-semibold">{l.label}</p>
              <p className="text-base text-slate-600">{l.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
