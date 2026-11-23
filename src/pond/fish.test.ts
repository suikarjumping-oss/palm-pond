import { describe, expect, it } from 'vitest';
import { FRY_START, KOI_PROFILES } from './constants';
import { awayToday, profilesFromRows, type FishRow } from './fish';

describe('fish', () => {
  it('keeps founder looks and names', () => {
    const [profile] = profilesFromRows([
      { id: 'koi-1', slug: 'koi-1', name: '小紅', pattern: 'kohaku', seed: 1, bornOn: null, grownDays: 30 },
    ]);
    expect(profile).toMatchObject({ ...KOI_PROFILES[0], markSeed: 'koi-1' });
  });

  it('fry start small and grow to adult size', () => {
    const row: FishRow = { id: 'f', slug: null, name: '抹茶', pattern: 'kohaku', seed: 42, bornOn: '2026-11-01', grownDays: 0 };
    const baby = profilesFromRows([row])[0];
    const adult = profilesFromRows([{ ...row, grownDays: 30 }])[0];
    expect(baby.size / adult.size).toBeCloseTo(FRY_START);
  });

  it('sends one or two fish out each day, nobody when the pond is small', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `fish-${i}`);
    const a = awayToday(ids, '2026-11-01');
    const b = awayToday(ids, '2026-11-02');
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(2);
    expect(a).not.toEqual(b);
    expect(awayToday(ids, '2026-11-01')).toEqual(a);
    expect(awayToday(ids.slice(0, 4), '2026-11-01')).toEqual([]);
  });
});
