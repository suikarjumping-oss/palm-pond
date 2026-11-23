/** 池子主畫面。玩法在 engine.ts，存檔在 store.ts，天氣在 weather.ts，天色季節在 sky.ts。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  KOI_PROFILES, LANTERN_COLORS, LANTERN_COUNT, NEWBORN_NOTICE_MS, NIGHT_MAX_ALPHA, NIGHT_RGB,
  REFLECTION_X_MAX, REFLECTION_X_MIN, REFLECTION_Y_MAX, REFLECTION_Y_MIN, SITE_TITLE, SKY_REFRESH_MS,
  TOSS_COOLDOWN_MS, WATER_BOUNDS, type KoiProfile,
} from './constants';
import { localDateKey } from './dates';
import { createKoiRenderer, type Reflection, type Ripple } from './draw';
import { addFish, initLake, scatter, setPointer, step, type Fish, type LakeState } from './engine';
import { awayToday, profilesFromRows } from './fish';
import { darkness, rainRipplesDue, seasonOf, type Season } from './sky';
import { createPondStore, type PondStore } from './store';
import { weatherAt, type PondEnv } from './weather';
import pondAutumn from '../assets/koi-lake.webp';
import pondSpring from '../assets/koi-lake-spring.webp';
import pondSummer from '../assets/koi-lake-summer.webp';
import pondWinter from '../assets/koi-lake-winter.webp';
import './pond.css';

interface Props {
  store?: PondStore;
  now?: () => Date;
}

/** 四季底圖構圖相同（WATER_BOUNDS 共用）。 */
const SEASON_BACKGROUNDS: Record<Season, string> = {
  spring: pondSpring,
  summer: pondSummer,
  autumn: pondAutumn,
  winter: pondWinter,
};

const frac = (value: number) => value - Math.floor(value);

/** 夜裡水面上的燈籠倒影，位置固定。 */
const LANTERNS: Reflection[] = Array.from({ length: LANTERN_COUNT }, (_, index) => {
  const seq = index + 1;
  return {
    x: REFLECTION_X_MIN + (REFLECTION_X_MAX - REFLECTION_X_MIN) * frac(seq * 0.6180339887 + 0.137),
    y: REFLECTION_Y_MIN + (REFLECTION_Y_MAX - REFLECTION_Y_MIN) * frac(seq * 0.7548776662 + 0.291),
    color: LANTERN_COLORS[index % LANTERN_COLORS.length],
    phase: frac(seq * 0.5698402909) * Math.PI * 2,
  };
});

const HINT_KEY = 'palm-pond-hinted';
const NAME_SHOW_MS = 2000;
const RIPPLE_MS = 900;
const POINTER_IDLE_MS = 150;
const defaultNow = () => new Date();

interface NameTag { id: string; name: string; x: number; y: number; key: number }
interface PointerSample { clientX: number; clientY: number; at: number }

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

function readHinted(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHinted() {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* 存不了就算了，下次再提示一次 */
  }
}

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const hasBox = rect.width > 0 && rect.height > 0;
  return {
    rect,
    hasBox,
    x: hasBox ? (event.clientX - rect.left) / rect.width : 0.5,
    y: hasBox ? (event.clientY - rect.top) / rect.height : 0.5,
  };
}

function hitsFish(fish: Fish, profile: KoiProfile, x: number, y: number, w: number, h: number): boolean {
  const length = profile.size * w * (0.88 + fish.z * 0.12);
  const angle = Math.atan2(Math.sin(fish.heading) * h, Math.cos(fish.heading) * w);
  const headX = fish.x * w;
  const headY = fish.y * h;
  const tailX = headX - Math.cos(angle) * length * 0.8;
  const tailY = headY - Math.sin(angle) * length * 0.8;
  const px = x * w;
  const py = y * h;
  const dx = tailX - headX;
  const dy = tailY - headY;
  const segmentLengthSquared = dx * dx + dy * dy;
  const along = segmentLengthSquared > 0
    ? Math.max(0, Math.min(1, ((px - headX) * dx + (py - headY) * dy) / segmentLengthSquared))
    : 0;
  const nearestX = headX + dx * along;
  const nearestY = headY + dy * along;
  return Math.hypot(px - nearestX, py - nearestY) <= Math.max(12, length * 0.2);
}

export default function Pond({ store: givenStore, now = defaultNow }: Props) {
  const storeRef = useRef<PondStore | null>(givenStore ?? null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<LakeState | null>(null);
  const profilesRef = useRef<readonly KoiProfile[]>(KOI_PROFILES);
  const rendererRef = useRef<ReturnType<typeof createKoiRenderer> | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const pointerSampleRef = useRef<PointerSample | null>(null);
  const lastTossRef = useRef(-Infinity);
  const sizeRef = useRef({ w: 0, h: 0 });
  const nameKey = useRef(0);
  const fedDayRef = useRef<string | null>(null);
  const envRef = useRef<PondEnv>({ windiness: 0, rain: 0 });
  const darknessRef = useRef(0);
  const [nowMs, setNowMs] = useState(() => now().getTime());
  const [hinted, setHinted] = useState(readHinted);
  const [tag, setTag] = useState<NameTag | null>(null);
  const [newborn, setNewborn] = useState<string | null>(null);

  if (storeRef.current === null) storeRef.current = createPondStore();
  if (rendererRef.current === null) rendererRef.current = createKoiRenderer();

  const current = new Date(nowMs);
  const dark = darkness(current);
  const env = weatherAt(current);
  const dateKey = localDateKey(current);

  useEffect(() => {
    darknessRef.current = dark;
    envRef.current = env;
  }, [dark, env]);

  useEffect(() => {
    const tick = () => setNowMs(now().getTime());
    const id = window.setInterval(tick, SKY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [now]);

  // 換日時重讀一次：出門的魚換人、小魚長大。
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;
    const all = profilesFromRows(store.open());
    const away = new Set(awayToday(all.map((profile) => profile.id), dateKey));
    const visible = all.filter((profile) => !away.has(profile.id));
    profilesRef.current = visible;
    stateRef.current = initLake(visible, Math.random);
  }, [dateKey]);

  useEffect(() => {
    if (!tag) return;
    const id = window.setTimeout(() => setTag(null), NAME_SHOW_MS);
    return () => window.clearTimeout(id);
  }, [tag]);

  useEffect(() => {
    if (!newborn) return;
    const id = window.setTimeout(() => setNewborn(null), NEWBORN_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [newborn]);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sizeRef.current = { w: rect.width, h: rect.height };
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resize();
    window.addEventListener('resize', resize);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }

    let raf = 0;
    let last = 0;
    const reduceMotion = reducedMotion();
    const speedScale = reduceMotion ? 0.5 : 1;
    const frame = (ts: number) => {
      const dt = last ? (ts - last) * speedScale : 0;
      last = ts;
      const sample = pointerSampleRef.current;
      const state = stateRef.current;
      const held = state?.pointer;
      if (state && sample && held && held.speed > 0 && performance.now() - sample.at > POINTER_IDLE_MS) {
        stateRef.current = setPointer(state, { ...held, speed: 0 });
      }
      const previous = stateRef.current;
      if (previous && dt > 0) {
        const next = step(previous, profilesRef.current, dt, Math.random, { windiness: envRef.current.windiness });
        for (const event of next.events) ripplesRef.current.push({ x: event.x, y: event.y, at: ts });
        stateRef.current = next;
      }
      const rain = envRef.current.rain;
      if (rain > 0 && dt > 0) {
        const drops = rainRipplesDue(rain, dt, Math.random, reduceMotion);
        for (let i = 0; i < drops; i++) {
          ripplesRef.current.push({ x: Math.random(), y: Math.random(), at: ts, small: true });
        }
      }
      ripplesRef.current = ripplesRef.current.filter((ripple) => ts - ripple.at < RIPPLE_MS);
      const { w, h } = sizeRef.current;
      if (ctx && stateRef.current && rendererRef.current && w > 0 && h > 0) {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        rendererRef.current(ctx, stateRef.current, profilesRef.current, ripplesRef.current, w, h, ts, reduceMotion, RIPPLE_MS,
          { darkness: darknessRef.current, reflections: LANTERNS });
      }
      raf = window.requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || typeof window.requestAnimationFrame !== 'function') return;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNowMs(now().getTime());
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', resize);
    };
  }, [resize, now]);

  const feedOnce = () => {
    const store = storeRef.current;
    const today = localDateKey(now());
    if (!store || fedDayRef.current === today) return;
    fedDayRef.current = today;
    const newId = store.feed(today, Math.random);
    if (!newId) return;
    const rows = store.open();
    const away = new Set(awayToday(rows.map((row) => row.id), today));
    const profiles = profilesFromRows(rows).filter((profile) => !away.has(profile.id));
    const baby = profiles.find((profile) => profile.id === newId);
    profilesRef.current = profiles;
    if (baby && stateRef.current) stateRef.current = addFish(stateRef.current, baby, Math.random);
    if (baby) setNewborn(baby.name);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { rect, hasBox, x, y } = canvasPoint(event);
    const state = stateRef.current;
    if (!state) return;
    const time = performance.now();
    pointerSampleRef.current = { clientX: event.clientX, clientY: event.clientY, at: time };
    stateRef.current = setPointer(state, { x, y, speed: 0 });
    if (hasBox) {
      for (const fish of state.fish) {
        const profile = profilesRef.current.find((item) => item.id === fish.id);
        if (!profile || !hitsFish(fish, profile, x, y, rect.width, rect.height)) continue;
        nameKey.current += 1;
        setTag({ id: fish.id, name: profile.name, x: fish.x, y: fish.y, key: nameKey.current });
        return;
      }
    }
    if (time - lastTossRef.current < TOSS_COOLDOWN_MS) return;
    lastTossRef.current = time;
    stateRef.current = scatter(stateRef.current, x, y, Math.random);
    ripplesRef.current.push({ x, y, at: time });
    feedOnce();
    if (!hinted) {
      writeHinted();
      setHinted(true);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const state = stateRef.current;
    if (!state) return;
    const { rect, x, y } = canvasPoint(event);
    const time = performance.now();
    const previous = pointerSampleRef.current;
    const elapsed = previous ? (time - previous.at) / 1000 : 0;
    const speed = previous && elapsed > 0 && rect.width > 0
      ? Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) / rect.width / elapsed
      : 0;
    pointerSampleRef.current = { clientX: event.clientX, clientY: event.clientY, at: time };
    stateRef.current = setPointer(state, { x, y, speed });
  };

  const clearPointer = () => {
    pointerSampleRef.current = null;
    if (stateRef.current) stateRef.current = setPointer(stateRef.current, null);
  };

  const water = {
    left: `${WATER_BOUNDS.left}%`, top: `${WATER_BOUNDS.top}%`,
    width: `${WATER_BOUNDS.width}%`, height: `${WATER_BOUNDS.height}%`,
  };

  return (
    <main className="pp-shell">
      <div className="pp-scene">
        <img className="pp-bg" src={SEASON_BACKGROUNDS[seasonOf(current)]} alt="" draggable={false} />
        <div className="pp-night" aria-hidden="true"
          style={{ background: `rgba(${NIGHT_RGB}, 1)`, opacity: dark * NIGHT_MAX_ALPHA }} />
        <div className="pp-water" style={water}>
          <canvas ref={canvasRef} className="pp-canvas" aria-label="池面，點一下撒飼料"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={clearPointer}
            onPointerCancel={clearPointer} onPointerLeave={clearPointer} />
          {tag && (
            <span key={tag.key} className="pp-name" role="status"
              style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}>{tag.name}</span>
          )}
        </div>
      </div>
      <h1 className="pp-title">{SITE_TITLE}</h1>
      {newborn && <p className="pp-notice" role="status">池裡多了一隻小魚：{newborn}</p>}
      {!hinted && <p className="pp-hint">點水面撒一點飼料</p>}
    </main>
  );
}
