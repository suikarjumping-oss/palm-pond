import { describe, expect, it } from 'vitest';
import { WEATHER_TABLE } from './constants';
import { darkness, seasonOf } from './sky';
import { weatherAt } from './weather';

describe('random weather', () => {
  it('is stable within a block and stays in range', () => {
    const a = weatherAt(new Date(2026, 10, 1, 9, 5));
    const b = weatherAt(new Date(2026, 10, 1, 11, 55));
    expect(a).toEqual(b);
    for (let d = 1; d <= 60; d++) {
      for (let h = 0; h < 24; h += 3) {
        const env = weatherAt(new Date(2026, 0, d, h));
        expect(env.windiness).toBeGreaterThanOrEqual(0);
        expect(env.windiness).toBeLessThanOrEqual(1);
        expect(env.rain).toBeGreaterThanOrEqual(0);
        expect(env.rain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is mostly calm but sometimes rains', () => {
    let rainy = 0;
    let total = 0;
    for (let d = 1; d <= 365; d++) {
      for (let h = 0; h < 24; h += 3) {
        total++;
        if (weatherAt(new Date(2026, 0, d, h)).rain > 0) rainy++;
      }
    }
    const expected = WEATHER_TABLE.filter((row) => row.rain[1] > 0).reduce((sum, row) => sum + row.chance, 0);
    expect(rainy / total).toBeGreaterThan(expected * 0.6);
    expect(rainy / total).toBeLessThan(expected * 1.4);
  });

  it('table sums to one', () => {
    expect(WEATHER_TABLE.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(1);
  });
});

describe('sky', () => {
  it('is dark at night, light at noon, half at sunset', () => {
    expect(darkness(new Date(2026, 10, 1, 2))).toBe(1);
    expect(darkness(new Date(2026, 10, 1, 12))).toBe(0);
    expect(darkness(new Date(2026, 10, 1, 18))).toBeCloseTo(0.5);
  });

  it('follows the local month', () => {
    expect(seasonOf(new Date(2026, 3, 1))).toBe('spring');
    expect(seasonOf(new Date(2026, 6, 1))).toBe('summer');
    expect(seasonOf(new Date(2026, 9, 1))).toBe('autumn');
    expect(seasonOf(new Date(2026, 11, 1))).toBe('winter');
  });
});
