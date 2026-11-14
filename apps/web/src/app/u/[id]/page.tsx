'use client';

import { useParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me, PostData } from '@/lib/community';
import { Button, Card, EmptyState, ListSkeleton, PageTitle } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import { PostCard, ReportButton } from '@/components/community/PostCard';

interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  role?: 'admin' | 'teacher' | 'student';
  line?: string | null;
  bio?: string | null;
  session?: string;
  group?: string;
  section?: string;
  classLevel?: number;
  coursesTaught?: string[];
  mentorOf?: string | null;
  inactiveNote?: string;
}

function Posts({ id, me }: { id: string; me: Me }) {
  const q = useInfiniteQuery({
    queryKey: ['feed', 'user', id],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: PostData[]; nextCursor: string | null }>(`/feed/users/${id}/posts${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-label="Recent posts" className="mt-6 flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Recent posts</h2>
      {q.isPending && <ListSkeleton rows={2} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="No posts yet" />}
      {items.map((p) => (
        <PostCard key={p.id} post={p} viewer={me} />
      ))}
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </section>
  );
}

function ProfileView({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['profile', id], queryFn: () => api<Profile>(`/users/${id}/public`), retry: false });
  if (q.isPending) return <ListSkeleton rows={2} />;
  if (q.isError) return <EmptyState title="This profile is not available" />;
  const p = q.data;
  return (
    <>
      <PageTitle>Profile</PageTitle>
      <Card className="flex flex-col gap-3" data-testid="public-profile">
        <div className="flex items-center gap-4">
          {p.avatarUrl ? (
            <img src={p.avatarUrl} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-indigo-100 text-3xl font-semibold text-indigo-700">
              {p.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{p.name}</p>
            {p.role && <p className="text-base capitalize text-slate-600">{p.role}</p>}
          </div>
        </div>
        {p.inactiveNote ? (
          <p className="text-base text-slate-700">{p.inactiveNote}</p>
        ) : (
          <>
            {p.role === 'student' && (
              <p className="text-base text-slate-800">
                {p.session} · {p.group ? p.group.charAt(0).toUpperCase() + p.group.slice(1) : ''} · Section {p.section} · Class {p.classLevel}
              </p>
            )}
            {p.role === 'teacher' && p.mentorOf && <p className="text-base text-slate-800">Section Mentor · {p.mentorOf}</p>}
            {p.role === 'teacher' && p.coursesTaught && p.coursesTaught.length > 0 && <p className="text-base text-slate-800">Teaches: {p.coursesTaught.join(', ')}</p>}
            {p.bio && <p className="whitespace-pre-wrap break-words text-base text-slate-800">{p.bio}</p>}
          </>
        )}
        {p.id !== me.id && !p.inactiveNote && <div><ReportButton targetType="user" targetId={p.id} /></div>}
      </Card>
      {!p.inactiveNote && <Posts id={id} me={me} />}
    </>
  );
}

export default function PublicProfilePage() {
  return <CommunityShell>{(me) => <ProfileView me={me} />}</CommunityShell>;
}
