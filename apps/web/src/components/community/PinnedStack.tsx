'use client';

import { useState } from 'react';
import { FEED_PINNED_EXPANDED } from '@cms/shared';
import type { Me, PostData } from '@/lib/community';
import { Button } from '@/components/ui';
import { PostCard } from './PostCard';

/**
 * Pinned announcements (06 §3.3-3.4): the first 5 are expanded and watched for "seen";
 * the rest stay collapsed (not watched) until the user opens "Show N more announcements".
 */
export function PinnedStack({ posts, viewer }: { posts: PostData[]; viewer?: Me }) {
  const [all, setAll] = useState(false);
  if (posts.length === 0) return null;
  const shown = all ? posts : posts.slice(0, FEED_PINNED_EXPANDED);
  const more = posts.length - FEED_PINNED_EXPANDED;
  return (
    <section aria-label="Pinned announcements" className="flex flex-col gap-3" data-testid="pinned-stack">
      {shown.map((p) => (
        <PostCard key={p.id} post={p} viewer={viewer} seen />
      ))}
      {!all && more > 0 && (
        <Button variant="secondary" onClick={() => setAll(true)} data-testid="show-more-pins">
          Show {more} more {more === 1 ? 'announcement' : 'announcements'}
        </Button>
      )}
    </section>
  );
}
