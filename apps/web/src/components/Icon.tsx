import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5" />,
  feed: <path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4Zm13 4h2v9a2 2 0 0 1-2 2M8.5 8.5h6M8.5 12h6M8.5 15.5h3" />,
  book: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6" />,
  chat: <path d="M4 5.5h16v10H12l-4.5 3.5v-3.5H4v-10Z" />,
  cap: <path d="m2.5 9 9.5-4.5L21.5 9 12 13.5 2.5 9ZM6.5 11.5V16c1.5 1.4 3.4 2 5.5 2s4-.6 5.5-2v-4.5M21.5 9v5" />,
  cal: <path d="M4 6.5h16V20H4V6.5ZM4 10.5h16M8 3.5v5M16 3.5v5" />,
  search: <path d="M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm5-1.5L20.5 20.5" />,
  horn: <path d="M4 10v4h3l8 4.5v-13L7 10H4Zm14 0.5a3 3 0 0 1 0 3M7 14l1 5h2.5l-1-4.7" />,
  bell: <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5ZM10 20.5a2 2 0 0 0 4 0" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8.5c.8-3.6 3.8-5.5 7.5-5.5s6.700 1.900 7.5 5.5" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.500V12l3 2" />,
  check: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.500-9 2.500 2.500 4.500-5" />,
  exam: <path d="M6 3.500h9l3.500 3.500v13.500H6V3.500ZM15 3.500V7h3.500M9 12h6M9 15.500h6" />,
  chart: <path d="M4 4v16h16M8 15l3.500-4 3 2.500L19 8" />,
  open: <path d="M7 11V8a5 5 0 0 1 9.500-2M5 11h14v9.500H5V11Z" />,
  bot: <path d="M5 8.500h14v10H5v-10ZM12 4.500v4M9 13h.01M15 13h.01M9.500 16h5M3 12.500v2M21 12.500v2" />,
  teach: <path d="M3 5h18v11H3V5Zm6 11-1 4.500M15 16l1 4.500M8 9h8" />,
  compass: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3-12-1.500 4.500L9 15l1.500-4.500L15 9Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />,
  shield: <path d="M12 3 4.500 6v5.500c0 4.500 3 7.800 7.500 9.500 4.500-1.700 7.500-5 7.500-9.500V6L12 3Z" />,
  folder: <path d="M3.500 6.500h6l2 2.500h9v10h-17v-12.500Z" />,
  school: <path d="M3 10 12 4l9 6M5 10v10h14V10M10 20v-5h4v5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

const MAP: Record<string, string> = {
  '🏠': 'home', '📰': 'feed', '📚': 'book', '💬': 'chat', '🎓': 'cap', '🗓': 'cal', '🔎': 'search', '📢': 'horn',
  '🔔': 'bell', '👤': 'user', '🕒': 'clock', '✅': 'check', '📝': 'exam', '📈': 'chart', '📖': 'book', '🔓': 'open',
  '🤖': 'bot', '👩‍🏫': 'teach', '🧭': 'compass', '➕': 'plus', '📥': 'down', '🛡': 'shield', '🗂': 'folder', '🏫': 'school', '☰': 'menu',
};

/** Line icon drawn in currentColor. `name` is a key above or the legacy emoji stored in lib/nav.ts. */
export function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const key = MAP[name.replace(/\uFE0F/g, '')] ?? name;
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {P[key] ?? P.compass}
    </svg>
  );
}
