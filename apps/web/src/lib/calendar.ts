/** Month helpers on plain YYYY-MM / YYYY-MM-DD strings (Dhaka dates, never Date#getDay on local time). */
export const todayYmd = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
export const todayYm = (): string => todayYmd().slice(0, 7);

export const shiftMonth = (ym: string, by: number): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
};
export const monthRange = (ym: string): { from: string; to: string } => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
};
/** Sunday-first grid: leading nulls, then every day of the month. */
export const monthCells = (ym: string): ({ date: string; day: number } | null)[] => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => ({ date: `${ym}-${String(i + 1).padStart(2, '0')}`, day: i + 1 }))];
};
