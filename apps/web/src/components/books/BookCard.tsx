'use client';

import Link from 'next/link';
import { Badge, Card } from '@/components/ui';
import { taka, type BookCardRow } from '@/lib/books';

/** A book as a card (never a table): cover, title, author, price, and an Unlocked badge. */
export function BookCard({ book, href }: { book: BookCardRow; href: string }) {
  return (
    <Link href={href} data-testid={`book-${book.id}`}>
      <Card className="flex h-full gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" className="h-28 w-20 shrink-0 rounded-md object-cover" /> : <div aria-hidden className="h-28 w-20 shrink-0 rounded-md bg-slate-200" />}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg font-semibold leading-snug">{book.title}</p>
          <p className="text-base text-slate-600">{book.author}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {book.unlocked ? <Badge tone="green">Unlocked</Badge> : <span className="text-base font-semibold">{taka(book.price)}</span>}
            {book.course && <span className="text-sm text-slate-500">{book.course}</span>}
          </div>
        </div>
      </Card>
    </Link>
  );
}
