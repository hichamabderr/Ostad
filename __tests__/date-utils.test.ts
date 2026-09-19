import { describe, expect, it } from 'vitest';
import { getLocalDateString } from '@/lib/date-utils';

describe('getLocalDateString', () => {
  it('formats a date without converting it to UTC', () => {
    expect(getLocalDateString(new Date(2026, 8, 18, 23, 59))).toBe('2026-09-18');
  });
});
