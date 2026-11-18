import Link from 'next/link';
import { DashboardCta } from '@/components/DashboardCta';
import { Reveal } from '@/components/Reveal';

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
const roleRow = 'group flex min-h-16 items-center justify-between gap-4 px-1 py-3 text-xl font-medium text-white transition-colors hover:text-mist';
const eyebrow = 'mb-4 text-xs font-bold uppercase tracking-[0.22em] text-rust';

/** Layered mountains over still water: pure SVG so it costs no image download. */
function HeroArt() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#003135_0%,#024950_38%,#0b8791_70%,#0fa4af_100%)]" />
      <div className="absolute left-[62%] top-[16%] h-20 w-20 rounded-full bg-mist/90 shadow-[0_0_120px_40px_rgba(175,221,229,0.45)] sm:h-28 sm:w-28" />
      <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-[-5%] bottom-0 h-[78%] w-[110%] animate-drift-slow">
        <path d="M0 330 220 150l130 120 150-170 190 230 140-110 200 160 170-90v310H0Z" fill="#024950" opacity=".75" />
      </svg>
      <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-[-5%] bottom-0 h-[62%] w-[110%] animate-drift">
        <path d="M0 420 160 260l120 90 170-200 150 210 130-90 230 180 240-120v250H0Z" fill="#003135" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-[26%] bg-[linear-gradient(180deg,rgba(15,164,175,0),#003135_95%)]" />
      <span className="absolute bottom-[14%] left-[48%] h-24 w-24 animate-ripple rounded-full border border-mist/60" />
      <span className="absolute bottom-[14%] left-[48%] h-24 w-24 animate-ripple rounded-full border border-mist/60 [animation-delay:2s]" />
    </div>
  );
}

const features = [
  ['Classes & attendance', 'Every period on one routine. Teachers mark attendance in seconds, students see it the same day.'],
  ['Exams that stay honest', 'Timed quizzes, instant scoring, and a clear progress line from first test to last.'],
  ['Notices that reach people', 'Urgent notices pin to the top and cannot be missed. The rest stays calm in the feed.'],
  ['A study helper', 'Ask a question about a lesson and get a patient, step-by-step answer, any time of day.'],
] as const;

export default async function Landing() {
  const [college, notices, books] = await Promise.all([
    load<College>('college'),
    load<{ items: Notice[] }>('notices'),
    load<{ items: Book[] }>('books/preview'),
  ]);
  const name = college?.name || 'College Management System';
  const contact = Object.entries(college?.contact ?? {}).filter(([, v]) => typeof v === 'string' && v);
  const depts = college?.departments ?? [];
  const loop = depts.length ? [...depts, ...depts] : [];
  return (
    <>
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 text-white sm:px-10">
        <div className="flex items-center gap-3">
          {college?.logoUrl ? (
            <img src={college.logoUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30" />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-rust" />
          )}
          <span className="font-display text-lg font-medium tracking-tight">{name}</span>
        </div>
        <Link href="/login" className="flex min-h-11 items-center rounded-full border border-white/40 px-5 text-sm font-semibold uppercase tracking-widest transition-colors hover:bg-white hover:text-ink">Login</Link>
      </header>

      <main>
        <section aria-labelledby="hero" className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden text-white">
          {college?.bannerUrl ? (
            <>
              <img src={college.bannerUrl} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 to-ink/20" />
            </>
          ) : (
            <div className="absolute inset-0 -z-10"><HeroArt /></div>
          )}
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-12 pt-32 sm:px-10 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:pb-16">
            <div className="animate-rise">
              <p className="mb-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist"><span className="h-px w-8 bg-rust" />Introducing</p>
              <h1 id="hero" className="text-[clamp(2.6rem,9vw,6.5rem)] font-light leading-[0.98]">{name}</h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-mist/90">Classes, attendance, exams, notices and your study helper, all in one place.</p>
            </div>
            <div className="animate-rise [animation-delay:200ms]">
              <DashboardCta>
                <Link href="/login?role=student" className={roleRow}>Student Login<span aria-hidden className="transition-transform group-hover:translate-x-2">→</span></Link>
                <Link href="/login?role=teacher" className={roleRow}>Teacher Login<span aria-hidden className="transition-transform group-hover:translate-x-2">→</span></Link>
                <Link href="/login?role=admin" className={roleRow}>Admin Login<span aria-hidden className="transition-transform group-hover:translate-x-2">→</span></Link>
              </DashboardCta>
            </div>
          </div>
        </section>

        <section aria-labelledby="about" className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1.6fr] lg:py-28">
          <Reveal>
            <p className={eyebrow}>The college</p>
            <h2 id="about" className="text-4xl font-light text-ink sm:text-5xl">About</h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="font-display text-2xl font-light leading-snug text-slate-800 sm:text-3xl">{college?.about || 'Welcome to our college.'}</p>
          </Reveal>
        </section>

        <section aria-label="What it does" className="bg-ink text-white">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-10 lg:py-28">
            <Reveal>
              <p className={eyebrow}>Everyday</p>
              <p className="font-display max-w-2xl text-3xl font-light leading-tight sm:text-5xl">Everything a school day needs, nothing it doesn&rsquo;t.</p>
            </Reveal>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-white/10 sm:grid-cols-2">
              {features.map(([t, d], i) => (
                <Reveal as="li" key={t} delay={i * 90} className="bg-ink p-7 transition-colors hover:bg-deep sm:p-10">
                  <span className="font-display text-sm text-rust">0{i + 1}</span>
                  <h3 className="font-display mt-3 text-2xl font-medium">{t}</h3>
                  <p className="mt-3 max-w-sm leading-relaxed text-mist/80">{d}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="departments" className="overflow-hidden py-20 lg:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-10">
            <Reveal>
              <p className={eyebrow}>Where you study</p>
              <h2 id="departments" className="text-4xl font-light text-ink sm:text-5xl">Departments</h2>
            </Reveal>
          </div>
          {loop.length ? (
            <div className="mt-10 flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]">
              {loop.map((d, i) => (
                <span key={`${d}-${i}`} aria-hidden={i >= depts.length ? true : undefined} className="font-display whitespace-nowrap rounded-full border border-ink/20 px-8 py-4 text-2xl font-light text-ink">{d}</span>
              ))}
            </div>
          ) : (
            <p className="mx-auto mt-6 max-w-6xl px-5 text-base text-slate-600 sm:px-10">Departments will be listed here.</p>
          )}
        </section>

        <section aria-labelledby="notices" className="bg-mist/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1.6fr] lg:py-28">
            <Reveal>
              <p className={eyebrow}>Noticeboard</p>
              <h2 id="notices" className="text-4xl font-light text-ink sm:text-5xl">Latest notices</h2>
            </Reveal>
            {notices?.items.length ? (
              <ul className="flex flex-col">
                {notices.items.slice(0, 5).map((n, i) => (
                  <Reveal as="li" key={n.id} delay={i * 70} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-ink/20 py-6 first:border-t-0 first:pt-0">
                    <span className="font-display text-2xl font-light text-rust">0{i + 1}</span>
                    <div>
                      <p className="font-display text-2xl font-medium text-ink">{n.title}</p>
                      <p className="mt-1 line-clamp-2 text-base text-slate-700">{strip(n.bodyHtml)}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            ) : (
              <p className="text-base text-slate-700">No public notices right now.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="books" className="mx-auto max-w-6xl px-5 py-20 sm:px-10 lg:py-28">
          <Reveal>
            <p className={eyebrow}>For students</p>
            <h2 id="books" className="text-4xl font-light text-ink sm:text-5xl">Book Shop</h2>
          </Reveal>
          {books?.items.length ? (
            <ul className="-mx-5 mt-10 flex snap-x gap-5 overflow-x-auto px-5 pb-4 sm:-mx-10 sm:px-10">
              {books.items.map((b, i) => (
                <li key={b.id} className={`w-36 shrink-0 snap-start sm:w-44 ${i % 2 ? 'mt-8' : ''}`}>
                  {b.coverUrl && <img src={b.coverUrl} alt="" loading="lazy" width={176} height={232} className="aspect-[3/4] w-full rounded-lg object-cover shadow-[0_20px_40px_-20px_rgba(0,49,53,0.6)] transition-transform duration-300 hover:-translate-y-2 hover:rotate-1" />}
                  <p className="font-display mt-3 line-clamp-2 text-base text-ink">{b.title}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-base text-slate-600">Books will appear here. Students unlock them after logging in.</p>
          )}
        </section>

        <section aria-labelledby="contact" className="bg-deep text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1.6fr] lg:py-24">
            <div>
              <p className={eyebrow}>Get in touch</p>
              <h2 id="contact" className="text-4xl font-light sm:text-5xl">Contact</h2>
            </div>
            {contact.length ? (
              <dl className="grid gap-5 text-lg">
                {contact.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-4 border-b border-white/15 pb-4">
                    <dt className="w-28 text-xs font-bold uppercase tracking-[0.2em] text-mist capitalize">{k}:</dt>
                    <dd className="font-display text-xl">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-base text-mist/80">Contact details will be added soon.</p>
            )}
          </div>
        </section>
      </main>

      <footer className="bg-ink px-5 py-8 text-center text-sm text-mist/70">
        © {new Date().getFullYear()} {name}
      </footer>
    </>
  );
}
