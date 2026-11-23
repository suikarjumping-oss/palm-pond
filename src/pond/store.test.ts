import { describe, expect, it } from 'vitest';
import { MAX_FISH } from './constants';
import { createPondStore, maybeSpawn, parseSave, STORAGE_KEY, type KeyValue, type PondSave } from './store';

function memory(initial?: string): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

const never = () => 0.99;
const always = () => 0;

describe('pond store', () => {
  it('starts with the eight founders, fully grown', () => {
    const rows = createPondStore(memory()).open();
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.grownDays === 30 && row.bornOn === null)).toBe(true);
  });

  it('counts each day once', () => {
    const storage = memory();
    const store = createPondStore(storage);
    store.feed('2026-11-01', never);
    store.feed('2026-11-01', never);
    const save = parseSave(storage.data.get(STORAGE_KEY) ?? null)!;
    expect(save.fedDays).toEqual(['2026-11-01']);
  });

  it('needs three feed days in seven before a fry can be born', () => {
    const store = createPondStore(memory());
    expect(store.feed('2026-11-01', always)).toBeNull();
    expect(store.feed('2026-11-03', always)).toBeNull();
    const id = store.feed('2026-11-05', always);
    expect(id).not.toBeNull();
    const fry = store.open().find((row) => row.id === id)!;
    expect(fry).toMatchObject({ slug: null, name: '抹茶', bornOn: '2026-11-05', grownDays: 1 });
  });

  it('does not spawn twice within seven days, and grows with feed days', () => {
    const store = createPondStore(memory());
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) store.feed(day, always);
    expect(store.feed('2026-11-04', always)).toBeNull();
    expect(store.feed('2026-11-09', always)).toBeNull();
    const fry = store.open().find((row) => row.slug === null)!;
    expect(fry.grownDays).toBe(3);
    expect(store.feed('2026-11-10', always)).not.toBeNull();
  });

  it('respects the roll', () => {
    const store = createPondStore(memory());
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) expect(store.feed(day, never)).toBeNull();
  });

  it('stops at the fish limit', () => {
    const save: PondSave = {
      v: 1,
      fish: Array.from({ length: MAX_FISH }, (_, i) => ({
        id: `f${i}`, slug: null, name: `n${i}`, pattern: 'solid' as const, seed: i, bornOn: null,
      })),
      fedDays: ['2026-11-01', '2026-11-02', '2026-11-03'],
    };
    expect(maybeSpawn(save, '2026-11-03', always)).toBeNull();
  });

  it('falls back to a fresh pond when the save is broken', () => {
    expect(createPondStore(memory('{not json')).open()).toHaveLength(8);
    expect(createPondStore(memory(JSON.stringify({ v: 2 }))).open()).toHaveLength(8);
  });

  it('drops malformed fish and bad dates', () => {
    const save = parseSave(JSON.stringify({
      v: 1,
      fish: [
        { id: 'a', slug: null, name: 'ok', pattern: 'solid', seed: 1, bornOn: '2026-11-01' },
        { id: 'b', slug: null, name: 'bad', pattern: 'nope', seed: 1, bornOn: null },
      ],
      fedDays: ['2026-11-01', 'yesterday', '2026-11-01'],
    }))!;
    expect(save.fish.map((fish) => fish.id)).toEqual(['a']);
    expect(save.fedDays).toEqual(['2026-11-01']);
  });

  it('keeps playing when storage throws', () => {
    const broken: KeyValue = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    const store = createPondStore({
      getItem: (key) => { try { return broken.getItem(key); } catch { return null; } },
      setItem: broken.setItem,
    });
    expect(store.open()).toHaveLength(8);
    expect(() => store.feed('2026-11-01', never)).not.toThrow();
  });
});
