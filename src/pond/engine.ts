/**
 * 池子的純函式。沒有畫面、沒有 Date.now()：
 * 時間（dtMs）與亂數都從外面傳進來，測試才能固定結果。回傳新的 state，不改舊的。
 */
import {
  BANK_SOFT_ZONE,
  BANK_STRENGTH,
  CHASE_SLOW_DIST,
  CHASE_SLOW_MIN,
  CHASE_SPEED_MULT,
  CHASE_TURN_FACTOR,
  CHASE_Z,
  CRUISE_TURN_FACTOR,
  CRUISE_VARIATION,
  CRUISE_VARIATION_MS,
  DEPTH_ARRIVE_DIST,
  DEPTH_EASE,
  EAT_RADIUS_FACTOR,
  EDGE_MARGIN_FACTOR,
  FLEE_MS,
  FLEE_SPEED_MULT,
  FLEE_Z,
  FULL_MS,
  LAKE_MAX,
  LAKE_MIN,
  MAX_BITES,
  MAX_DT_MS,
  MAX_PELLETS,
  MAX_TURN_RATE,
  NOT_REACTING,
  PELLET_EDGE_MARGIN,
  PELLET_LIFETIME_MS,
  PELLETS_PER_TOSS,
  POINTER_ATTRACT_R,
  POINTER_ATTRACT_SPEED_MULT,
  POINTER_ATTRACT_STRENGTH,
  POINTER_FAST,
  POINTER_FLEE_R,
  POINTER_SLOW,
  REACT_BASE_MS,
  REACT_JITTER_MS,
  SEPARATION_DZ,
  SEPARATION_FACTOR,
  SEPARATION_STRENGTH,
  SPEED_EASE,
  TOSS_SPREAD,
  TURN_EASE,
  TURN_RESPONSE,
  WANDER_ARRIVE_DIST,
  WIND_DEPTH_SHIFT,
  WIND_REACT_MULT,
  WIND_RISE_SLOW,
  Z_MAX,
  Z_MIN,
  type KoiProfile,
} from './constants';

export type Rng = () => number;

export interface Fish {
  id: string;
  x: number;
  y: number;
  /** 朝向，弧度，-π..π。 */
  heading: number;
  /** 目前速度，湖寬/秒。 */
  speed: number;
  wanderTarget: { x: number; y: number };
  /** 正在追的飼料；沒有就 null。 */
  pelletId: string | null;
  /** 注意到飼料後開始追的時間；NOT_REACTING 表示沒在反應。 */
  reactAt: number;
  /** 飽到這個時間為止不追飼料。 */
  fullUntil: number;
  /** 這一輪已吃幾顆（吃滿變飽後歸零）。 */
  bites: number;
  /** 水深 0..1，1 是水面。 */
  z: number;
  targetZ: number;
  /** 目前角速度，弧度/秒。 */
  turnRate: number;
  /** 受驚逃跑到這個時間為止。 */
  fleeUntil: number;
}

export interface Pellet {
  id: string;
  x: number;
  y: number;
  bornAt: number;
}

export interface LakePointer {
  x: number;
  y: number;
  /** 湖寬/秒。 */
  speed: number;
}

export interface BiteEvent {
  type: 'bite';
  x: number;
  y: number;
}

export interface LakeState {
  /** 累計模擬時間 ms。 */
  t: number;
  fish: Fish[];
  pellets: Pellet[];
  /** 下一顆飼料的流水號。 */
  seq: number;
  /** 只有這一步新發生的畫面事件。 */
  events: BiteEvent[];
  pointer: LakePointer | null;
}

/** 可重現的亂數（測試與畫面用）。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 魚身體中心允許的邊距。 */
function marginOf(p: KoiProfile): number {
  return p.size * EDGE_MARGIN_FACTOR;
}

function randomPoint(p: KoiProfile, rng: Rng): { x: number; y: number } {
  const m = marginOf(p);
  const span = LAKE_MAX - LAKE_MIN - 2 * m;
  return { x: LAKE_MIN + m + rng() * span, y: LAKE_MIN + m + rng() * span };
}

function randomDepth(rng: Rng, min = Z_MIN, max = Z_MAX): number {
  return min + rng() * (max - min);
}

/** 角度差正規化到 -π..π。 */
function angleDiff(a: number, b: number): number {
  const d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) return d - 2 * Math.PI;
  if (d < -Math.PI) return d + 2 * Math.PI;
  return d;
}

export function initLake(profiles: readonly KoiProfile[], rng: Rng): LakeState {
  const fish = profiles.map((p): Fish => {
    const pos = randomPoint(p, rng);
    const z = randomDepth(rng);
    return {
      id: p.id,
      x: pos.x,
      y: pos.y,
      heading: (rng() * 2 - 1) * Math.PI,
      speed: p.speed,
      wanderTarget: randomPoint(p, rng),
      pelletId: null,
      reactAt: NOT_REACTING,
      fullUntil: 0,
      bites: 0,
      z,
      targetZ: randomDepth(rng),
      turnRate: 0,
      fleeUntil: 0,
    };
  });
  return { t: 0, fish, pellets: [], seq: 0, events: [], pointer: null };
}

/** 新生魚從湖邊出現，朝湖心游進來。 */
export function addFish(state: LakeState, profile: KoiProfile, rng: Rng): LakeState {
  if (state.fish.some((fish) => fish.id === profile.id)) return state;
  const margin = marginOf(profile);
  const along = margin + rng() * (1 - 2 * margin);
  const edge = Math.floor(rng() * 4);
  const x = edge === 0 ? margin : edge === 1 ? 1 - margin : along;
  const y = edge === 2 ? margin : edge === 3 ? 1 - margin : along;
  const z = randomDepth(rng);
  const fish: Fish = {
    id: profile.id,
    x,
    y,
    heading: Math.atan2(0.5 - y, 0.5 - x),
    speed: profile.speed,
    wanderTarget: randomPoint(profile, rng),
    pelletId: null,
    reactAt: NOT_REACTING,
    fullUntil: 0,
    bites: 0,
    z,
    targetZ: randomDepth(rng),
    turnRate: 0,
    fleeUntil: 0,
  };
  return { ...state, fish: [...state.fish, fish] };
}

export function setPointer(state: LakeState, pointer: LakePointer | null): LakeState {
  return { ...state, pointer: pointer ? { ...pointer } : null };
}

export function scatter(state: LakeState, x: number, y: number, rng: Rng): LakeState {
  const added: Pellet[] = [];
  for (let i = 0; i < PELLETS_PER_TOSS; i++) {
    const angle = rng() * 2 * Math.PI;
    const r = Math.sqrt(rng()) * TOSS_SPREAD;
    added.push({
      id: `p${state.seq + i}`,
      x: clamp(x + Math.cos(angle) * r, LAKE_MIN + PELLET_EDGE_MARGIN, LAKE_MAX - PELLET_EDGE_MARGIN),
      y: clamp(y + Math.sin(angle) * r, LAKE_MIN + PELLET_EDGE_MARGIN, LAKE_MAX - PELLET_EDGE_MARGIN),
      bornAt: state.t,
    });
  }
  const pellets = [...state.pellets, ...added].slice(-MAX_PELLETS);
  return { ...state, pellets, seq: state.seq + PELLETS_PER_TOSS, events: [] };
}

export function step(
  state: LakeState,
  profiles: readonly KoiProfile[],
  dtMs: number,
  rng: Rng,
  env: { windiness: number } = { windiness: 0 },
): LakeState {
  const dt = clamp(dtMs, 0, MAX_DT_MS);
  const t = state.t + dt;
  const sec = dt / 1000;
  const windiness = clamp(env.windiness, 0, 1);
  const zMin = Z_MIN - windiness * WIND_DEPTH_SHIFT;
  const zMax = Z_MAX - windiness * WIND_DEPTH_SHIFT;
  let pellets = state.pellets.filter((p) => t - p.bornAt < PELLET_LIFETIME_MS);
  const fish: Fish[] = state.fish.map((f) => ({ ...f, wanderTarget: { ...f.wanderTarget } }));
  const sourceFish = state.fish;
  const events: BiteEvent[] = [];

  fish.forEach((f, i) => {
    const prof = profiles.find((p) => p.id === f.id);
    if (!prof) return;
    const bold = prof.boldness;
    const isFull = t < f.fullUntil;
    const pointer = state.pointer;
    const pointerDist = pointer ? Math.hypot(pointer.x - f.x, pointer.y - f.y) : Infinity;

    if (pointer && pointer.speed > POINTER_FAST && pointerDist < POINTER_FLEE_R) {
      const awayAngle = pointerDist > 0
        ? Math.atan2(f.y - pointer.y, f.x - pointer.x)
        : f.heading + Math.PI;
      const m = marginOf(prof);
      f.wanderTarget = {
        x: clamp(f.x + Math.cos(awayAngle) * POINTER_FLEE_R, LAKE_MIN + m, LAKE_MAX - m),
        y: clamp(f.y + Math.sin(awayAngle) * POINTER_FLEE_R, LAKE_MIN + m, LAKE_MAX - m),
      };
      f.fleeUntil = Math.max(f.fleeUntil, t + FLEE_MS);
      f.targetZ = FLEE_Z;
      f.pelletId = null;
      f.reactAt = NOT_REACTING;
    }
    const isFleeing = t < f.fleeUntil;

    const claimedByBolder = (pelletId: string): boolean =>
      fish.some((o, j) => j !== i && o.pelletId === pelletId && (profiles.find((p) => p.id === o.id)?.boldness ?? 0) > bold);

    if (f.pelletId !== null) {
      const id = f.pelletId;
      if (isFull || isFleeing || !pellets.some((p) => p.id === id) || claimedByBolder(id)) {
        f.pelletId = null;
        f.reactAt = NOT_REACTING;
      }
    }

    if (f.pelletId === null && !isFull && !isFleeing && pellets.length > 0 && f.reactAt === NOT_REACTING) {
      const jitter = rng() * REACT_JITTER_MS;
      f.reactAt = windiness === 0
        ? t + REACT_BASE_MS * (1 - bold) + jitter
        : t + (REACT_BASE_MS * (1 - bold) + jitter) * (1 + windiness * WIND_REACT_MULT);
    }
    if (pellets.length === 0 || isFleeing) f.reactAt = NOT_REACTING;

    if (f.pelletId === null && !isFleeing && f.reactAt !== NOT_REACTING && t >= f.reactAt) {
      let best: Pellet | null = null;
      let bestD = Infinity;
      for (const p of pellets) {
        if (claimedByBolder(p.id)) continue;
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (best) f.pelletId = best.id;
      else f.reactAt = NOT_REACTING;
    }

    const target = f.pelletId !== null ? pellets.find((p) => p.id === f.pelletId) : undefined;
    let tx: number;
    let ty: number;
    if (target) {
      tx = target.x;
      ty = target.y;
    } else {
      if (!isFleeing && Math.hypot(f.wanderTarget.x - f.x, f.wanderTarget.y - f.y) < WANDER_ARRIVE_DIST) {
        f.wanderTarget = randomPoint(prof, rng);
      }
      tx = f.wanderTarget.x;
      ty = f.wanderTarget.y;
    }

    const baseAngle = Math.atan2(ty - f.y, tx - f.x);
    let dirX = Math.cos(baseAngle);
    let dirY = Math.sin(baseAngle);
    let attracted = false;
    if (!target && !isFleeing && pointer && pointer.speed < POINTER_SLOW && pointerDist < POINTER_ATTRACT_R && pointerDist > 0) {
      const strength = clamp(bold * POINTER_ATTRACT_STRENGTH * (1 - pointerDist / POINTER_ATTRACT_R), 0, 1);
      dirX = dirX * (1 - strength) + ((pointer.x - f.x) / pointerDist) * strength;
      dirY = dirY * (1 - strength) + ((pointer.y - f.y) / pointerDist) * strength;
      attracted = true;
    }

    let sepX = 0;
    let sepY = 0;
    for (let j = 0; j < sourceFish.length; j++) {
      const other = sourceFish[j];
      if (j === i || Math.abs(f.z - other.z) >= SEPARATION_DZ) continue;
      const dx = f.x - other.x;
      const dy = f.y - other.y;
      const d = Math.hypot(dx, dy);
      const minDist = prof.size * SEPARATION_FACTOR;
      if (d >= minDist) continue;
      const push = 1 - d / minDist;
      if (d > 0) {
        sepX += (dx / d) * push;
        sepY += (dy / d) * push;
      } else {
        const splitAngle = (i / Math.max(1, sourceFish.length)) * Math.PI * 2;
        sepX += Math.cos(splitAngle);
        sepY += Math.sin(splitAngle);
      }
    }
    dirX += sepX * SEPARATION_STRENGTH;
    dirY += sepY * SEPARATION_STRENGTH;

    const m = marginOf(prof);
    const edgeDist = Math.min(f.x - m, 1 - m - f.x, f.y - m, 1 - m - f.y);
    if (edgeDist < BANK_SOFT_ZONE) {
      const strength = BANK_STRENGTH * (1 - Math.max(0, edgeDist) / BANK_SOFT_ZONE);
      const centerAngle = Math.atan2(0.5 - f.y, 0.5 - f.x);
      dirX += Math.cos(centerAngle) * strength;
      dirY += Math.sin(centerAngle) * strength;
    }

    const desiredHeading = Math.atan2(dirY, dirX);
    const turnFactor = isFleeing ? 1 : target || attracted ? CHASE_TURN_FACTOR : CRUISE_TURN_FACTOR;
    const desiredTurnRate = clamp(
      angleDiff(f.heading, desiredHeading) * TURN_RESPONSE,
      -MAX_TURN_RATE * turnFactor,
      MAX_TURN_RATE * turnFactor,
    );
    f.turnRate += (desiredTurnRate - f.turnRate) * Math.min(1, TURN_EASE * sec);
    f.turnRate = clamp(f.turnRate, -MAX_TURN_RATE, MAX_TURN_RATE);
    const headingDelta = clamp(f.turnRate * sec, -MAX_TURN_RATE * sec, MAX_TURN_RATE * sec);
    f.heading = angleDiff(0, f.heading + headingDelta);

    let targetSpeed = prof.speed * (
      1 + Math.sin((t / CRUISE_VARIATION_MS) * Math.PI * 2 + (i / Math.max(1, fish.length)) * Math.PI * 2) * CRUISE_VARIATION
    );
    if (target) {
      const dist = Math.hypot(tx - f.x, ty - f.y);
      targetSpeed *= CHASE_SPEED_MULT * clamp(dist / CHASE_SLOW_DIST, CHASE_SLOW_MIN, 1);
    } else if (isFleeing) {
      targetSpeed *= FLEE_SPEED_MULT;
    } else if (attracted) {
      targetSpeed *= 1 + (POINTER_ATTRACT_SPEED_MULT - 1) * bold;
    }
    f.speed += (targetSpeed - f.speed) * Math.min(1, SPEED_EASE * sec);

    if (isFleeing) f.targetZ = FLEE_Z;
    else if (target) f.targetZ = CHASE_Z;
    else if (f.targetZ < zMin || f.targetZ > zMax || Math.abs(f.z - f.targetZ) < DEPTH_ARRIVE_DIST) {
      f.targetZ = randomDepth(rng, zMin, zMax);
    }
    const depthEase = f.targetZ > f.z && windiness > 0
      ? DEPTH_EASE * (1 - windiness * WIND_RISE_SLOW)
      : DEPTH_EASE;
    f.z = clamp(f.z + (f.targetZ - f.z) * Math.min(1, depthEase * sec), 0, 1);

    f.x = clamp(f.x + Math.cos(f.heading) * f.speed * sec, LAKE_MIN + m, LAKE_MAX - m);
    f.y = clamp(f.y + Math.sin(f.heading) * f.speed * sec, LAKE_MIN + m, LAKE_MAX - m);

    if (target && Math.hypot(tx - f.x, ty - f.y) < prof.size * EAT_RADIUS_FACTOR) {
      pellets = pellets.filter((p) => p.id !== target.id);
      events.push({ type: 'bite', x: target.x, y: target.y });
      f.pelletId = null;
      f.reactAt = NOT_REACTING;
      f.bites += 1;
      if (f.bites >= Math.ceil(prof.appetite * MAX_BITES)) {
        f.bites = 0;
        f.fullUntil = t + FULL_MS;
      }
    }
  });

  return { t, fish, pellets, seq: state.seq, events, pointer: state.pointer ? { ...state.pointer } : null };
}
