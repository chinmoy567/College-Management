'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errMsg, groupLabel, sectionLabel } from '@/lib/queries';
import { Card, EmptyState, ErrorState, ListSkeleton, PageTitle } from '@/components/ui';

interface Item {
  id: string;
  name: string;
  classLevel: number;
  group: { type: string; session: { name: string } };
}

export default function MentorsPage() {
  const q = useQuery({ queryKey: ['no-mentor'], queryFn: () => api<{ items: Item[] }>('/academics/alerts/sections-without-mentor') });
  return (
    <>
      <PageTitle>Sections without a mentor</PageTitle>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="Every section has a mentor" />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.items.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/sections/${s.id}`}>
                <Card>
                  <p className="text-lg font-semibold">{sectionLabel(s)}</p>
                  <p className="text-base text-slate-600">{s.group.session.name} · {groupLabel(s.group.type)} · tap to assign</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
