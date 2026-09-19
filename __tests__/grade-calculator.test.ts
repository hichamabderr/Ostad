import { describe, expect, it } from 'vitest';
import {
  calculateContinuousEvaluation,
  calculateStudentAverage
} from '@/lib/grade-calculator';

describe('calculateStudentAverage', () => {
  it('calculates the official average with one quiz', () => {
    expect(calculateStudentAverage(16, 12, 14)).toBe(14);
  });

  it('does not calculate an average when quiz is missing', () => {
    expect(calculateStudentAverage(16, null, 14)).toBeNull();
  });

  it('does not calculate an average when a required mark is missing', () => {
    expect(calculateStudentAverage(16, 12, null)).toBeNull();
  });

  it('rejects marks outside the 0 to 20 range', () => {
    expect(calculateStudentAverage(21, 12, 14)).toBeNull();
    expect(calculateStudentAverage(16, 12, Number.NaN)).toBeNull();
  });

  it('calculates continuous evaluation from four capped components', () => {
    expect(calculateContinuousEvaluation(4, 3.5, 5, 2.25)).toBe(14.75);
    expect(calculateContinuousEvaluation(8, -1, 5, 5)).toBe(15);
  });
});
