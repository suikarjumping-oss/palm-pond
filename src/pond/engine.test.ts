import { describe, expect, it } from 'vitest';
import {
  CHASE_Z,
  FULL_MS,
  KOI_PROFILES,
  MAX_BITES,
  MAX_DT_MS,
  MAX_PELLETS,
  MAX_TURN_RATE,
  PELLET_LIFETIME_MS,
  PELLETS_PER_TOSS,
  POINTER_FAST,
  type KoiProfile,
} from './constants';
import { addFish, initLake, mulberry32, scatter, setPointer, step, type LakeState } from './engine';

const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** 跑 n 步，每步 dt ms。 */
function run(
  state: LakeState,
  profiles: readonly KoiProfile[],
  n: number,
  dt: number,
  rng: () => number,
  onStep?: (s: LakeState, prev: LakeState) => void,
): LakeState {
  let s = state;
  for (let i = 0; i < n; i++) {
    const next = step(s, profiles, dt, rng);
    onStep?.(next, s);
    s = next;
  }
  return s;
}

describe('koiLake engine', () => {
  it('新生魚從湖邊朝湖心游進來', () => {
    const state = initLake(KOI_PROFILES.slice(0, 1), mulberry32(20));
    const profile = { ...KOI_PROFILES[1], id: 'new-fry' };
    const next = addFish(state, profile, mulberry32(21));
    const fish = next.fish.at(-1)!;
    const margin = profile.size * 0.5;
    expect(next).not.toBe(state);
    expect(state.fish).toHaveLength(1);
    expect(next.fish).toHaveLength(2);
    expect(
      fish.x === margin || fish.x === 1 - margin || fish.y === margin || fish.y === 1 - margin,
    ).toBe(true);
    expect(Math.cos(fish.heading) * (0.5 - fish.x) + Math.sin(fish.heading) * (0.5 - fish.y)).toBeGreaterThan(0);
  });

  it('魚永遠在湖內（10 分鐘模擬，含撒飼料）', () => {
    const rng = mulberry32(1);
    let s = initLake(KOI_PROFILES, rng);
    for (let i = 0; i < 6000; i++) {
      if (i % 200 === 0) s = scatter(s, rng(), rng(), rng);
      s = step(s, KOI_PROFILES, 100, rng);
      for (const f of s.fish) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x).toBeLessThanOrEqual(1);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeLessThanOrEqual(1);
      }
    }
  }, 20_000); // 6000 步模擬，整套平行跑時 CPU 被搶會超過預設 5 秒

  it('單步轉向不超過上限', () => {
    const rng = mulberry32(2);
    let s = initLake(KOI_PROFILES, rng);
    s = scatter(s, 0.5, 0.5, rng);
    run(s, KOI_PROFILES, 600, 50, rng, (next, prev) => {
      next.fish.forEach((f, i) => {
        expect(Math.abs(angleDiff(prev.fish[i].heading, f.heading))).toBeLessThanOrEqual(
          MAX_TURN_RATE * 0.05 + 1e-9,
        );
      });
    });
  });

  it('撒飼料數量正確，超過上限丟掉最舊的', () => {
    const rng = mulberry32(3);
    let s = initLake(KOI_PROFILES, rng);
    s = scatter(s, 0.5, 0.5, rng);
    expect(s.pellets).toHaveLength(PELLETS_PER_TOSS);
    for (const p of s.pellets) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
    const firstId = s.pellets[0].id;
    for (let i = 0; i < 10; i++) s = scatter(s, 0.5, 0.5, rng);
    expect(s.pellets).toHaveLength(MAX_PELLETS);
    expect(s.pellets.some((p) => p.id === firstId)).toBe(false);
    expect(s.pellets[s.pellets.length - 1].id).toBe(`p${s.seq - 1}`);
  });

  it('飼料過期消失', () => {
    const rng = mulberry32(4);
    // 魚都很飽，不會去吃。
    let s = initLake(KOI_PROFILES, rng);
    s = { ...s, fish: s.fish.map((f) => ({ ...f, fullUntil: 1e9 })) };
    s = scatter(s, 0.5, 0.5, rng);
    s = run(s, KOI_PROFILES, Math.floor(PELLET_LIFETIME_MS / 100) - 5, 100, rng);
    expect(s.pellets).toHaveLength(PELLETS_PER_TOSS);
    s = run(s, KOI_PROFILES, 10, 100, rng);
    expect(s.pellets).toHaveLength(0);
  });

  it('吃滿會飽，飽了不追', () => {
    const rng = mulberry32(5);
    const greedy = KOI_PROFILES.find((p) => p.appetite === 1) as KoiProfile;
    const profiles = [greedy];
    let s = initLake(profiles, rng);
    s = { ...s, fish: [{ ...s.fish[0], x: 0.5, y: 0.5 }] };
    // 一顆一顆餵，直到吃滿 MAX_BITES 顆。
    let guard = 0;
    while (s.fish[0].fullUntil <= s.t && guard++ < 200) {
      if (s.pellets.length === 0) s = scatter(s, s.fish[0].x, s.fish[0].y, rng);
      s = step(s, profiles, 100, rng);
    }
    expect(s.fish[0].fullUntil).toBeGreaterThan(s.t);
    expect(s.fish[0].fullUntil - s.t).toBeLessThanOrEqual(FULL_MS);
    expect(MAX_BITES).toBeGreaterThan(0);
    // 飽了之後再撒，魚不鎖定飼料。
    s = scatter(s, 0.5, 0.5, rng);
    s = run(s, profiles, 30, 100, rng, (next) => {
      if (next.t < next.fish[0].fullUntil) expect(next.fish[0].pelletId).toBeNull();
    });
    expect(s.fish[0].pelletId).toBeNull();
  });

  it('同一組亂數結果固定', () => {
    const play = (seed: number): LakeState => {
      const rng = mulberry32(seed);
      let s = initLake(KOI_PROFILES, rng);
      s = scatter(s, 0.4, 0.6, rng);
      return run(s, KOI_PROFILES, 300, 50, rng);
    };
    expect(play(7)).toEqual(play(7));
    expect(play(7)).not.toEqual(play(8));
  });

  it('不改動傳入的 state', () => {
    const rng = mulberry32(9);
    let s = initLake(KOI_PROFILES, rng);
    s = scatter(s, 0.5, 0.5, rng);
    const snapshot = structuredClone(s);
    step(s, KOI_PROFILES, 50, rng);
    scatter(s, 0.2, 0.2, rng);
    setPointer(s, { x: 0.2, y: 0.2, speed: 0 });
    expect(s).toEqual(snapshot);
  });

  it('深度留在 0..1，追飼料時往水面上升', () => {
    const rng = mulberry32(12);
    const profiles = [KOI_PROFILES[0]];
    let s = initLake(profiles, rng);
    s = {
      ...s,
      pellets: [{ id: 'food', x: 0.8, y: 0.5, bornAt: 0 }],
      fish: [{
        ...s.fish[0],
        x: 0.3,
        y: 0.5,
        z: 0.4,
        targetZ: 0.4,
        pelletId: 'food',
        reactAt: 0,
      }],
    };
    const before = s.fish[0].z;
    s = run(s, profiles, 10, 50, rng);
    expect(s.fish[0].targetZ).toBe(CHASE_Z);
    expect(s.fish[0].z).toBeGreaterThan(before);
    expect(s.fish[0].z).toBeGreaterThanOrEqual(0);
    expect(s.fish[0].z).toBeLessThanOrEqual(1);
  });

  it('吃到飼料只在當步產生 bite event', () => {
    const rng = mulberry32(13);
    const profiles = [KOI_PROFILES[0]];
    let s = initLake(profiles, rng);
    s = {
      ...s,
      pellets: [{ id: 'food', x: 0.5, y: 0.5, bornAt: 0 }],
      fish: [{ ...s.fish[0], x: 0.5, y: 0.5, pelletId: 'food', reactAt: 0 }],
    };
    s = step(s, profiles, 50, rng);
    expect(s.events).toEqual([{ type: 'bite', x: 0.5, y: 0.5 }]);
    s = step(s, profiles, 50, rng);
    expect(s.events).toEqual([]);
  });

  it('快速手指讓附近的魚逃開並下潛', () => {
    const rng = mulberry32(14);
    const profiles = [KOI_PROFILES[0]];
    let s = initLake(profiles, rng);
    s = {
      ...s,
      fish: [{ ...s.fish[0], x: 0.5, y: 0.5, z: 0.8, targetZ: 0.8, heading: 0 }],
    };
    const pointer = { x: 0.45, y: 0.5, speed: POINTER_FAST + 1 };
    s = setPointer(s, pointer);
    const beforeDist = Math.hypot(s.fish[0].x - pointer.x, s.fish[0].y - pointer.y);
    s = run(s, profiles, 20, 50, rng);
    const afterDist = Math.hypot(s.fish[0].x - pointer.x, s.fish[0].y - pointer.y);
    expect(afterDist).toBeGreaterThan(beforeDist);
    expect(s.fish[0].z).toBeLessThan(0.8);
    expect(s.fish[0].fleeUntil).toBeGreaterThan(s.t);
  });

  it('慢手指會讓大膽的魚靠近', () => {
    const rng = mulberry32(15);
    const profiles = [KOI_PROFILES[0]];
    let s = initLake(profiles, rng);
    s = {
      ...s,
      fish: [{
        ...s.fish[0],
        x: 0.3,
        y: 0.5,
        heading: Math.PI,
        turnRate: 0,
        wanderTarget: { x: 0.1, y: 0.5 },
      }],
    };
    const pointer = { x: 0.5, y: 0.5, speed: 0 };
    const beforeDist = Math.hypot(s.fish[0].x - pointer.x, s.fish[0].y - pointer.y);
    s = setPointer(s, pointer);
    s = run(s, profiles, 80, 50, rng);
    const afterDist = Math.hypot(s.fish[0].x - pointer.x, s.fish[0].y - pointer.y);
    expect(afterDist).toBeLessThan(beforeDist);
  });

  it('同水深重疊的魚會逐漸分開', () => {
    const rng = mulberry32(16);
    const profiles = KOI_PROFILES.slice(0, 2);
    let s = initLake(profiles, rng);
    s = {
      ...s,
      fish: s.fish.map((f) => ({
        ...f,
        x: 0.5,
        y: 0.5,
        z: 0.6,
        targetZ: 0.6,
        heading: Math.PI / 2,
        turnRate: 0,
        wanderTarget: { x: 0.5, y: 0.8 },
      })),
    };
    s = run(s, profiles, 40, 50, rng);
    expect(Math.hypot(s.fish[0].x - s.fish[1].x, s.fish[0].y - s.fish[1].y)).toBeGreaterThan(0.01);
  });

  it('換亂數種子後最先吃到的魚會變（20 次至少 3 隻不同）', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      let s = initLake(KOI_PROFILES, rng);
      s = scatter(s, 0.5, 0.5, rng);
      for (let i = 0; i < 600 && s.pellets.length === PELLETS_PER_TOSS; i++) {
        s = step(s, KOI_PROFILES, 50, rng);
      }
      const first = s.fish.find((f) => f.bites > 0 || f.fullUntil > 0);
      if (first) firsts.add(first.id);
    }
    expect(firsts.size).toBeGreaterThanOrEqual(3);
  });

  it('膽小的魚平均比大膽的晚到', () => {
    const bold = KOI_PROFILES.reduce((a, b) => (b.boldness > a.boldness ? b : a));
    const timid = KOI_PROFILES.reduce((a, b) => (b.boldness < a.boldness ? b : a));
    // 同身長、同速度、同起點，只差脾氣。
    const profiles: KoiProfile[] = [bold, timid].map((p) => ({
      ...p,
      size: 0.1,
      speed: 0.05,
      appetite: 1,
    }));
    const firstEatTime = (id: string, seed: number): number => {
      const rng = mulberry32(seed);
      let s = initLake(profiles, rng);
      s = {
        ...s,
        fish: s.fish.map((f) => ({ ...f, x: 0.3, y: 0.5, heading: 0, wanderTarget: { x: 0.3, y: 0.5 } })),
      };
      // 各自一組飼料，避免互搶。
      s = scatter(s, 0.7, 0.5, rng);
      for (let i = 0; i < 1200; i++) {
        s = step(s, profiles, 50, rng);
        const f = s.fish.find((x) => x.id === id);
        if (f && f.bites > 0) return s.t;
      }
      return 60000;
    };
    let boldSum = 0;
    let timidSum = 0;
    const n = 30;
    for (let seed = 1; seed <= n; seed++) {
      boldSum += firstEatTime(bold.id, seed);
      timidSum += firstEatTime(timid.id, seed);
    }
    expect(timidSum / n).toBeGreaterThan(boldSum / n);
  });

  it('dtMs 超過上限會截斷', () => {
    const rng = mulberry32(11);
    const s = initLake(KOI_PROFILES, rng);
    const next = step(s, KOI_PROFILES, 10000, rng);
    expect(next.t).toBe(MAX_DT_MS);
    const small = step(s, KOI_PROFILES, MAX_DT_MS, mulberry32(11));
    expect(next.fish).toEqual(small.fish);
  });

  it('不傳 env 和 windiness 0 的結果完全相同', () => {
    const state = initLake(KOI_PROFILES, mulberry32(40));
    const withoutEnv = step(state, KOI_PROFILES, 50, mulberry32(41));
    const calm = step(state, KOI_PROFILES, 50, mulberry32(41), { windiness: 0 });
    expect(withoutEnv).toEqual(calm);
  });

  it('同一組種子下強風魚的平均水深較深', () => {
    const averageDepth = (windiness: number): number => {
      const rng = mulberry32(42);
      let state = initLake(KOI_PROFILES, rng);
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 1200; i++) {
        state = step(state, KOI_PROFILES, 100, rng, { windiness });
        if (i >= 200) {
          sum += state.fish.reduce((total, fish) => total + fish.z, 0);
          count += state.fish.length;
        }
      }
      return sum / count;
    };
    expect(averageDepth(1)).toBeLessThan(averageDepth(0));
  });

  it('同一組種子下強風的第一口比較晚', () => {
    const profile: KoiProfile = { ...KOI_PROFILES[0], speed: 0, boldness: 0.5, appetite: 1 };
    const firstBiteAt = (windiness: number): number => {
      const rng = mulberry32(43);
      let state = initLake([profile], rng);
      state = {
        ...state,
        pellets: [{ id: 'food', x: state.fish[0].x, y: state.fish[0].y, bornAt: 0 }],
      };
      for (let i = 0; i < 100; i++) {
        state = step(state, [profile], 50, rng, { windiness });
        if (state.events.some((event) => event.type === 'bite')) return state.t;
      }
      return Infinity;
    };
    expect(firstBiteAt(1)).toBeGreaterThan(firstBiteAt(0));
  });
});
