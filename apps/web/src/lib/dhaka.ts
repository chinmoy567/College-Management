/** All times on screen are Asia/Dhaka (FE-11). */
const TZ = 'Asia/Dhaka';
export const formatDhakaTime = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const formatDhakaDate = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
export const formatDhaka = (iso: string | Date): string =>
  new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
