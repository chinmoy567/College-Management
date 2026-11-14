'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Me, PostData } from '@/lib/community';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui';
import { CommunityShell } from '@/components/community/CommunityShell';
import { Comments } from '@/components/community/Comments';
import { PostCard } from '@/components/community/PostCard';

function Detail({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['feed', 'post', id], queryFn: () => api<PostData>(`/feed/posts/${id}`), retry: false });
  if (q.isPending) return <ListSkeleton rows={2} />;
  if (q.isError) return q.error && 'status' in q.error && (q.error as { status: number }).status === 404 ? <EmptyState title="This post is not available" /> : <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <PostCard post={q.data} viewer={me} detail />
      <Comments postId={id} viewer={me} />
    </div>
  );
}

export default function PostPage() {
  return <CommunityShell>{(me) => <Detail me={me} />}</CommunityShell>;
}
