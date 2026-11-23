/** 存檔裡的魚 → 畫面用的 KoiProfile；每天出門的魚。 */
import { AWAY_MIN_FISH, FRY_START, GROW_DAYS, KOI_PROFILES, type KoiProfile } from './constants';
import { dayNumber } from './dates';
import { mulberry32 } from './engine';

export type KoiPattern = KoiProfile['pattern'];

export interface FishRow {
  id: string;
  /** 一開始的 8 隻是 'koi-1'…；小魚是 null。 */
  slug: string | null;
  name: string;
  pattern: KoiPattern;
  seed: number;
  /** 小魚出生日 YYYY-MM-DD；一開始的魚是 null。 */
  bornOn: string | null;
  /** 長大了幾天（0..GROW_DAYS）。 */
  grownDays: number;
}

const FOUNDER_BY_SLUG = new Map(KOI_PROFILES.map((profile) => [profile.id, profile]));
const PALE = ['#f4f1ea', '#f6f2ea', '#ece7dc', '#f1e5cf'] as const;
const RED = ['#c93624', '#d94a2f', '#b92f2a', '#df653c'] as const;
const DARK = ['#202126', '#343238', '#17282a', '#41342d'] as const;
const GOLD = ['#d99a20', '#e6b83d', '#e3c56b', '#c8812b'] as const;
const BLUE = ['#8faabd', '#a8bbc7', '#7898ad', '#b1c6cc'] as const;

const range = (rng: () => number, min: number, max: number): number => min + rng() * (max - min);
const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

function fryColours(pattern: KoiPattern, rng: () => number): Pick<KoiProfile, 'body' | 'patches'> {
  const pale = pick(PALE, rng);
  const red = pick(RED, rng);
  const dark = pick(DARK, rng);
  const gold = pick(GOLD, rng);
  const blue = pick(BLUE, rng);
  if (pattern === 'kohaku') return { body: pale, patches: [red, pick(RED, rng)] };
  if (pattern === 'sanke') return { body: pale, patches: [red, dark] };
  if (pattern === 'showa') return { body: dark, patches: [red, pale] };
  if (pattern === 'tancho') return { body: pale, patches: [red] };
  if (pattern === 'asagi') return { body: pale, patches: [blue, red] };
  return { body: pick([gold, pale, dark, blue], rng), patches: [pick([pale, gold, blue], rng)] };
}

export function profilesFromRows(rows: readonly FishRow[]): KoiProfile[] {
  return rows.map((row) => {
    const founder = row.slug ? FOUNDER_BY_SLUG.get(row.slug) : undefined;
    if (founder) return { ...founder, id: row.id, name: row.name, markSeed: founder.id };

    const rng = mulberry32(row.seed);
    const adultSize = range(rng, 0.1, 0.175);
    const speed = range(rng, 0.03, 0.08);
    const boldness = rng();
    const appetite = rng();
    const colours = fryColours(row.pattern, rng);
    const grown = Math.min(GROW_DAYS, Math.max(0, row.grownDays));
    const growth = FRY_START + (1 - FRY_START) * grown / GROW_DAYS;
    return {
      id: row.id,
      name: row.name,
      pattern: row.pattern,
      size: adultSize * growth,
      speed,
      boldness,
      appetite,
      markSeed: row.seed,
      ...colours,
    };
  });
}

/** 每天有 1–2 隻魚出門、隔天回來；魚不多時大家都在家。 */
export function awayToday(ids: readonly string[], dateKey: string): string[] {
  const fish = [...new Set(ids)].sort();
  if (fish.length <= AWAY_MIN_FISH) return [];
  const day = dayNumber(dateKey);
  if (day === null) return [];
  const start = ((day % fish.length) + fish.length) % fish.length;
  const count = 1 + Math.abs(day % 2);
  return Array.from({ length: count }, (_, offset) => fish[(start + offset) % fish.length]);
}
