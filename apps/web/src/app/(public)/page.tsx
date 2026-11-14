import Link from 'next/link';
import { DashboardCta } from '@/components/DashboardCta';

type College = { name: string; about: string; departments: string[]; contact: Record<string, string>; logoUrl: string | null; bannerUrl: string | null };
type Notice = { id: string; title: string; bodyHtml: string; priority: string; publishedAt: string | null };
type Book = { id: string; title: string; coverUrl: string | null };

const base = () => `http://127.0.0.1:${process.env.PORT ?? 3000}/api/public`;

/** Public data, cached 5 minutes; a failure leaves the section out instead of breaking the page. */
async function load<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${base()}/${path}`, { next: { revalidate: 300 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const roleBtn = 'flex min-h-12 items-center justify-center rounded-xl px-4 text-lg font-semibold';

export default async function Landing() {
  const [college, notices, books] = await Promise.all([
    load<College>('college'),
    load<{ items: Notice[] }>('notices'),
    load<{ items: Book[] }>('books/preview'),
  ]);
  const name = college?.name || 'College Management System';
  const contact = Object.entries(college?.contact ?? {}).filter(([, v]) => typeof v === 'string' && v);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {college?.logoUrl && <img src={college.logoUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />}
          <span className="text-lg font-semibold">{name}</span>
        </div>
        <Link href="/login" className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-indigo-700">Login</Link>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6">
        <section aria-labelledby="hero" className="flex flex-col gap-4 rounded-2xl bg-indigo-600 p-6 text-white">
          <h1 id="hero" className="text-3xl font-bold">{name}</h1>
          <p className="text-lg text-indigo-100">Classes, attendance, exams, notices and your study helper, all in one place.</p>
          <DashboardCta>
            <Link href="/login?role=student" className={`${roleBtn} bg-white text-indigo-700`}>Student Login</Link>
            <Link href="/login?role=teacher" className={`${roleBtn} bg-indigo-500 text-white`}>Teacher Login</Link>
            <Link href="/login?role=admin" className={`${roleBtn} bg-indigo-800 text-white`}>Admin Login</Link>
          </DashboardCta>
        </section>

        <section aria-labelledby="about">
          <h2 id="about" className="mb-2 text-2xl font-semibold">About</h2>
          <p className="text-base text-slate-700">{college?.about || 'Welcome to our college.'}</p>
        </section>

        <section aria-labelledby="departments">
          <h2 id="departments" className="mb-2 text-2xl font-semibold">Departments</h2>
          {college?.departments.length ? (
            <ul className="flex flex-wrap gap-2">
              {college.departments.map((d) => <li key={d} className="rounded-full bg-slate-200 px-3 py-1 text-base">{d}</li>)}
            </ul>
          ) : <p className="text-base text-slate-600">Departments will be listed here.</p>}
        </section>

        <section aria-labelledby="notices">
          <h2 id="notices" className="mb-2 text-2xl font-semibold">Latest notices</h2>
          {notices?.items.length ? (
            <ul className="flex flex-col gap-3">
              {notices.items.slice(0, 5).map((n) => (
                <li key={n.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-lg font-semibold">{n.title}</p>
                  <p className="line-clamp-2 text-base text-slate-600">{strip(n.bodyHtml)}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-base text-slate-600">No public notices right now.</p>}
        </section>

        <section aria-labelledby="books">
          <h2 id="books" className="mb-2 text-2xl font-semibold">Book Shop</h2>
          {books?.items.length ? (
            <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
              {books.items.map((b) => (
                <li key={b.id} className="w-32 shrink-0 snap-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {b.coverUrl && <img src={b.coverUrl} alt="" loading="lazy" width={128} height={170} className="h-44 w-32 rounded-lg object-cover" />}
                  <p className="mt-1 line-clamp-2 text-base">{b.title}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-base text-slate-600">Books will appear here. Students unlock them after logging in.</p>}
        </section>

        <section aria-labelledby="contact">
          <h2 id="contact" className="mb-2 text-2xl font-semibold">Contact</h2>
          {contact.length ? (
            <dl className="grid gap-1 text-base">
              {contact.map(([k, v]) => (
                <div key={k} className="flex gap-2"><dt className="font-medium capitalize">{k}:</dt><dd>{v}</dd></div>
              ))}
            </dl>
          ) : <p className="text-base text-slate-600">Contact details will be added soon.</p>}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-base text-slate-600">
        © {new Date().getFullYear()} {name}
      </footer>
    </>
  );
}
