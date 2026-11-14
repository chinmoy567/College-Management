import { describe, expect, it } from 'vitest';
import { dhakaDate, formatDhaka, toUtc, weekdayOf } from './time';

describe('time', () => {
  it('[CONV-07] dhaka date at 18:00 UTC boundary', () => {
    expect(dhakaDate(new Date('2026-03-10T17:59:59Z'))).toBe('2026-03-10');
    expect(dhakaDate(new Date('2026-03-10T18:00:00Z'))).toBe('2026-03-11');
    expect(formatDhaka(new Date('2026-03-10T18:00:00Z'), 'HH:mm')).toBe('00:00');
  });

  it('[CONV-07] toUtc converts Dhaka wall clock to UTC (+06:00)', () => {
    expect(toUtc('2026-03-11', '00:00').toISOString()).toBe('2026-03-10T18:00:00.000Z');
    expect(toUtc('2026-03-11', '09:30').toISOString()).toBe('2026-03-11T03:30:00.000Z');
  });

  it('[CONV-07] weekday is computed from the Dhaka date', () => {
    expect(weekdayOf('2026-03-11')).toBe(3); // Wednesday
  });
});
