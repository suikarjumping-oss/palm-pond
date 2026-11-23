/**
 * 每位訪客自己的池子，只存在這台裝置的瀏覽器（localStorage）。
 * 存不了（無痕、被擋）時退回記憶體，這次照常玩，下次重來。
 */
import {
  FRY_NAMES, GROW_DAYS, KOI_PROFILES, MAX_FISH, SPAWN_CHANCE, SPAWN_MIN_FEED_DAYS, SPAWN_WINDOW_DAYS,
} from './constants';
import { dayNumber } from './dates';
import type { FishRow, KoiPattern } from './fish';

export const STORAGE_KEY = 'palm-pond-v1';
const PATTERNS: readonly KoiPattern[] = ['kohaku', 'sanke', 'showa', 'tancho', 'solid', 'asagi'];
/** 餵食日只留最近這麼多天（長大最多算 GROW_DAYS 天，生小魚看 7 天）。 */
const KEEP_FEED_DAYS = 400;

interface StoredFish {
  id: string;
  slug: string | null;
  name: string;
  pattern: KoiPattern;
  seed: number;
  bornOn: string | null;
}

export interface PondSave {
  v: 1;
  fish: StoredFish[];
  fedDays: string[];
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function memoryStorage(): KeyValue {
  const map = new Map<string, string>();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
}

export function browserStorage(): KeyValue {
  try {
    const storage = window.localStorage;
    const probe = '__palm-pond-probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

function freshSave(): PondSave {
  return {
    v: 1,
    fish: KOI_PROFILES.map((profile, index) => ({
      id: profile.id, slug: profile.id, name: profile.name, pattern: profile.pattern, seed: index + 1, bornOn: null,
    })),
    fedDays: [],
  };
}

const isDateKey = (value: unknown): value is string => typeof value === 'string' && dayNumber(value) !== null;

function parseFish(value: unknown): StoredFish | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  if (row.slug !== null && typeof row.slug !== 'string') return null;
  if (typeof row.name !== 'string' || row.name === '') return null;
  if (typeof row.pattern !== 'string' || !PATTERNS.includes(row.pattern as KoiPattern)) return null;
  if (typeof row.seed !== 'number' || !Number.isInteger(row.seed)) return null;
  if (row.bornOn !== null && !isDateKey(row.bornOn)) return null;
  return {
    id: row.id, slug: row.slug, name: row.name, pattern: row.pattern as KoiPattern, seed: row.seed, bornOn: row.bornOn,
  };
}

export function parseSave(text: string | null): PondSave | null {
  if (!text) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    if (record.v !== 1 || !Array.isArray(record.fish) || !Array.isArray(record.fedDays)) return null;
    const fish = record.fish.map(parseFish).filter((row): row is StoredFish => row !== null);
    if (fish.length === 0) return null;
    const fedDays = [...new Set(record.fedDays.filter(isDateKey))].sort();
    return { v: 1, fish: fish.slice(0, MAX_FISH), fedDays };
  } catch {
    return null;
  }
}

function toRows(save: PondSave): FishRow[] {
  return save.fish.map((fish) => ({
    ...fish,
    grownDays: fish.bornOn === null
      ? GROW_DAYS
      : Math.min(GROW_DAYS, save.fedDays.filter((day) => day >= fish.bornOn!).length),
  }));
}

function nextFryName(save: PondSave): string {
  const used = new Set(save.fish.map((fish) => fish.name));
  const free = FRY_NAMES.find((name) => !used.has(name));
  if (free) return free;
  for (let n = 2; ; n++) {
    const name = `${FRY_NAMES[0]}${n}`;
    if (!used.has(name)) return name;
  }
}

/** 照規則決定今天要不要生小魚；要的話回新魚，不改 save。 */
export function maybeSpawn(save: PondSave, today: string, rng: () => number): StoredFish | null {
  const todayNum = dayNumber(today);
  if (todayNum === null || save.fish.length >= MAX_FISH) return null;
  const inWindow = (key: string | null) => {
    const n = key === null ? null : dayNumber(key);
    return n !== null && n > todayNum - SPAWN_WINDOW_DAYS && n <= todayNum;
  };
  if (save.fedDays.filter(inWindow).length < SPAWN_MIN_FEED_DAYS) return null;
  if (save.fish.some((fish) => inWindow(fish.bornOn))) return null;
  if (rng() >= SPAWN_CHANCE) return null;
  const seed = Math.floor(rng() * 2147483647);
  return {
    id: `fry-${today}-${seed}`,
    slug: null,
    name: nextFryName(save),
    pattern: PATTERNS[Math.floor(rng() * PATTERNS.length)],
    seed,
    bornOn: today,
  };
}

export interface PondStore {
  open(): FishRow[];
  /** 記今天餵過；一天只算一次。回新生小魚的 id，沒生回 null。 */
  feed(today: string, rng: () => number): string | null;
}

export function createPondStore(storage: KeyValue = browserStorage()): PondStore {
  const load = (): PondSave => parseSave(storage.getItem(STORAGE_KEY)) ?? freshSave();
  const save = (data: PondSave) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 存不了就只活在這次 */
    }
  };
  return {
    open() {
      const data = load();
      save(data);
      return toRows(data);
    },
    feed(today, rng) {
      const data = load();
      if (dayNumber(today) === null || data.fedDays.includes(today)) return null;
      const fedDays = [...data.fedDays, today].sort().slice(-KEEP_FEED_DAYS);
      const withDay: PondSave = { ...data, fedDays };
      const fry = maybeSpawn(withDay, today, rng);
      save(fry ? { ...withDay, fish: [...withDay.fish, fry] } : withDay);
      return fry?.id ?? null;
    },
  };
}
