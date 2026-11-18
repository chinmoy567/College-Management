'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Fades and lifts its children in once, when they scroll into view. Visual only. */
export function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'section' | 'p' }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return void el.classList.add('in');
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const T = Tag as 'div';
  return (
    <T ref={ref as never} className={`reveal ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>
      {children}
    </T>
  );
}
