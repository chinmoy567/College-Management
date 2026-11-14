import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { DISPLAY_TZ } from '@cms/shared';

/** Asia/Dhaka calendar date (YYYY-MM-DD) of an instant. */
export const dhakaDate = (now: Date = new Date()): string =>
  formatInTimeZone(now, DISPLAY_TZ, 'yyyy-MM-dd');

/** Dhaka date + wall-clock time ("HH:mm") → UTC instant. */
export const toUtc = (date: string, time: string): Date =>
  fromZonedTime(`${date}T${time}:00`, DISPLAY_TZ);

export const formatDhaka = (ts: Date, fmt = 'yyyy-MM-dd HH:mm'): string =>
  formatInTimeZone(ts, DISPLAY_TZ, fmt);

/** 0 = Sunday … 6 = Saturday, for a Dhaka calendar date. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
