import { NIGHT_MAX_ALPHA, NIGHT_RGB, type KoiProfile } from './constants';
import { mulberry32, type Fish, type LakeState } from './engine';

const SEGMENT_COUNT = 22;
const BODY_PROFILE = [
  0.58, 0.79, 0.92, 0.98, 1, 0.98, 0.94, 0.88, 0.81, 0.73, 0.65,
  0.57, 0.49, 0.42, 0.35, 0.28, 0.22, 0.17, 0.13, 0.1, 0.08, 0.07,
] as const;
const WATER_VEIL = '#1f6f66';

interface Point {
  x: number;
  y: number;
  angle: number;
}

interface Marking {
  start: number;
  end: number;
  side: number;
  spread: number;
  color: string;
  alpha: number;
  crown?: boolean;
}

interface RenderFish {
  spine: Point[];
  markings: Marking[];
  contour: Point[];
  patchPoints: Point[];
  phase: number;
  width: number;
  height: number;
}

export interface Ripple {
  x: number;
  y: number;
  at: number;
  /** 雨滴漣漪：更小、更淡、更短。 */
  small?: boolean;
}

/** 光點倒影：只含位置和顏色，不含正文。 */
export interface Reflection {
  x: number;
  y: number;
  color: string;
  phase: number;
}

export interface SkyDraw {
  darkness: number;
  reflections: readonly Reflection[];
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function pointArray(length: number): Point[] {
  return Array.from({ length }, () => ({ x: 0, y: 0, angle: 0 }));
}

function addPatch(
  markings: Marking[],
  start: number,
  end: number,
  side: number,
  spread: number,
  color: string,
  alpha = 0.94,
  crown = false,
) {
  markings.push({ start, end, side, spread, color, alpha, crown });
}

function makeMarkings(profile: KoiProfile, rng: () => number): Marking[] {
  const markings: Marking[] = [];
  const random = (min: number, max: number) => min + rng() * (max - min);
  const red = profile.patches[0] ?? '#d44224';
  const dark = profile.patches[1] ?? '#20262a';

  if (profile.pattern === 'tancho') {
    addPatch(markings, 2, 2, 0, 0.72, red, 0.96, true);
  } else if (profile.pattern === 'asagi') {
    addPatch(markings, 2.2, 17.5, 0, 0.7, profile.patches[0] ?? '#58738a', 0.78);
    addPatch(markings, 3, 10, -0.75, 0.32, profile.patches[1] ?? '#c86646', 0.68);
    addPatch(markings, 3, 10, 0.75, 0.32, profile.patches[1] ?? '#c86646', 0.68);
  } else if (profile.pattern === 'showa') {
    addPatch(markings, 1, 6, random(-0.25, 0.25), 0.96, profile.patches[1] ?? '#ece8df');
    addPatch(markings, 8, 14.5, random(-0.2, 0.2), 0.9, profile.patches[1] ?? '#ece8df');
    addPatch(markings, 0.8, 4.8, random(-0.2, 0.2), 0.78, red);
    addPatch(markings, 7, 12, random(-0.25, 0.25), 0.86, red);
    addPatch(markings, 14, 18, random(-0.2, 0.2), 0.72, red);
  } else if (profile.pattern === 'kohaku' || profile.pattern === 'sanke') {
    let cursor = random(0.8, 1.8);
    const count = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < count && cursor < 16; i++) {
      const span = random(3, 5.2);
      addPatch(markings, cursor, Math.min(18, cursor + span), random(-0.22, 0.22), random(0.74, 1.02), red);
      cursor += span + random(1.3, 2.8);
    }
    if (profile.pattern === 'sanke') {
      const spots = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < spots; i++) {
        const start = random(2.5, 16);
        addPatch(markings, start, start + random(0.8, 1.8), random(-0.48, 0.48), random(0.25, 0.42), dark, 0.92);
      }
    }
  }
  return markings;
}

function createRenderFish(profile: KoiProfile): RenderFish {
  const seed = typeof profile.markSeed === 'number' ? profile.markSeed >>> 0 : hashId(profile.markSeed ?? profile.id);
  const rng = mulberry32(seed);
  return {
    spine: pointArray(SEGMENT_COUNT),
    markings: makeMarkings(profile, rng),
    contour: pointArray(50),
    patchPoints: pointArray(16),
    phase: rng() * Math.PI * 2,
    width: 0,
    height: 0,
  };
}

function traceSmoothClosedCurve(ctx: CanvasRenderingContext2D, points: Point[], count: number) {
  if (count < 3) return;
  const last = points[count - 1];
  const first = points[0];
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) * 0.5, (last.y + first.y) * 0.5);
  for (let i = 0; i < count; i++) {
    const point = points[i];
    const next = points[(i + 1) % count];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) * 0.5, (point.y + next.y) * 0.5);
  }
  ctx.closePath();
}

function updateSpine(renderFish: RenderFish, fish: Fish, profile: KoiProfile, w: number, h: number, nowMs: number) {
  const depthScale = 0.88 + fish.z * 0.12;
  const length = profile.size * w * depthScale;
  const stepLength = length * 0.037;
  const headX = fish.x * w;
  const headY = fish.y * h;
  const heading = Math.atan2(Math.sin(fish.heading) * h, Math.cos(fish.heading) * w);
  const head = renderFish.spine[0];
  const reset = renderFish.width !== w
    || renderFish.height !== h
    || Math.hypot(headX - head.x, headY - head.y) > length * 1.5;

  if (reset) {
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const point = renderFish.spine[i];
      point.x = headX - Math.cos(heading) * stepLength * i;
      point.y = headY - Math.sin(heading) * stepLength * i;
      point.angle = heading;
    }
    renderFish.width = w;
    renderFish.height = h;
  }

  head.x = headX;
  head.y = headY;
  head.angle = heading;
  const speedRatio = Math.max(0.35, fish.speed / profile.speed);
  const phase = renderFish.phase + nowMs * 0.001 * (2.5 + speedRatio * 1.7);
  for (let i = 1; i < SEGMENT_COUNT; i++) {
    const previous = renderFish.spine[i - 1];
    const current = renderFish.spine[i];
    let segmentAngle = Math.atan2(previous.y - current.y, previous.x - current.x);
    const tail = i / (SEGMENT_COUNT - 1);
    const wave = Math.pow(tail, 2.05) * (0.035 + speedRatio * 0.024 + Math.abs(fish.turnRate) * 0.008);
    segmentAngle += Math.sin(phase - i * 0.36) * wave + fish.turnRate * 0.012 * tail;
    current.x = previous.x - Math.cos(segmentAngle) * stepLength;
    current.y = previous.y - Math.sin(segmentAngle) * stepLength;
    current.angle = segmentAngle;
  }
}

function bodyContour(renderFish: RenderFish, profile: KoiProfile, fish: Fish, w: number): number {
  const depthScale = 0.88 + fish.z * 0.12;
  const length = profile.size * w * depthScale;
  const maxHalfWidth = length * 0.16;
  const head = renderFish.spine[0];
  const perp = head.angle + Math.PI * 0.5;
  const snoutWidth = BODY_PROFILE[0] * maxHalfWidth;
  const noseLength = length * 0.04;
  const contour = renderFish.contour;
  let count = 0;
  const put = (x: number, y: number) => {
    contour[count].x = x;
    contour[count].y = y;
    count++;
  };

  put(head.x + Math.cos(head.angle) * noseLength + Math.cos(perp) * snoutWidth * 0.54,
    head.y + Math.sin(head.angle) * noseLength + Math.sin(perp) * snoutWidth * 0.54);
  put(head.x + Math.cos(head.angle) * noseLength * 0.42 + Math.cos(perp) * snoutWidth,
    head.y + Math.sin(head.angle) * noseLength * 0.42 + Math.sin(perp) * snoutWidth);
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const point = renderFish.spine[i];
    const side = point.angle + Math.PI * 0.5;
    const halfWidth = BODY_PROFILE[i] * maxHalfWidth;
    put(point.x + Math.cos(side) * halfWidth, point.y + Math.sin(side) * halfWidth);
  }
  for (let i = SEGMENT_COUNT - 1; i >= 0; i--) {
    const point = renderFish.spine[i];
    const side = point.angle + Math.PI * 0.5;
    const halfWidth = BODY_PROFILE[i] * maxHalfWidth;
    put(point.x - Math.cos(side) * halfWidth, point.y - Math.sin(side) * halfWidth);
  }
  put(head.x + Math.cos(head.angle) * noseLength * 0.42 - Math.cos(perp) * snoutWidth,
    head.y + Math.sin(head.angle) * noseLength * 0.42 - Math.sin(perp) * snoutWidth);
  put(head.x + Math.cos(head.angle) * noseLength - Math.cos(perp) * snoutWidth * 0.54,
    head.y + Math.sin(head.angle) * noseLength - Math.sin(perp) * snoutWidth * 0.54);
  return count;
}

function sampleSpine(renderFish: RenderFish, segment: number): Point {
  const index = Math.max(0, Math.min(SEGMENT_COUNT - 1, Math.floor(segment)));
  const next = Math.min(SEGMENT_COUNT - 1, index + 1);
  const fraction = segment - index;
  const a = renderFish.spine[index];
  const b = renderFish.spine[next];
  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
    angle: a.angle + (b.angle - a.angle) * fraction,
  };
}

function drawPairedFin(
  ctx: CanvasRenderingContext2D,
  renderFish: RenderFish,
  segment: number,
  side: number,
  length: number,
  halfWidth: number,
  color: string,
  phase: number,
) {
  const anchor = renderFish.spine[segment];
  const perp = anchor.angle + Math.PI * 0.5;
  const ax = anchor.x + Math.cos(perp) * halfWidth * BODY_PROFILE[segment] * side * 0.72;
  const ay = anchor.y + Math.sin(perp) * halfWidth * BODY_PROFILE[segment] * side * 0.72;
  const angle = anchor.angle + side * (1.75 + Math.sin(phase + side) * 0.09);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(angle);
  ctx.globalAlpha = 0.46;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.28, -side * length * 0.22, length * 0.84, -side * length * 0.18, length, 0);
  ctx.bezierCurveTo(length * 0.78, side * length * 0.26, length * 0.25, side * length * 0.2, 0, 0);
  ctx.fill();
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = '#fffdf4';
  ctx.lineWidth = Math.max(0.45, length * 0.025);
  for (let i = 1; i <= 5; i++) {
    const offset = (i / 6 - 0.5) * length * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(length * 0.5, offset, length * (0.74 + i * 0.035), offset * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTail(
  ctx: CanvasRenderingContext2D,
  renderFish: RenderFish,
  length: number,
  color: string,
  phase: number,
) {
  const tail = renderFish.spine[SEGMENT_COUNT - 1];
  const tailLength = length * 0.22;
  const spread = length * 0.105;
  ctx.save();
  ctx.translate(tail.x, tail.y);
  ctx.rotate(tail.angle + Math.PI + Math.sin(phase - 2.8) * 0.12);
  ctx.globalAlpha = 0.58;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(tailLength * 0.35, -spread * 0.75, tailLength * 0.82, -spread, tailLength, -spread * 0.58);
  ctx.bezierCurveTo(tailLength * 0.82, -spread * 0.15, tailLength * 0.72, 0, tailLength * 0.66, 0);
  ctx.bezierCurveTo(tailLength * 0.72, 0, tailLength * 0.82, spread * 0.15, tailLength, spread * 0.58);
  ctx.bezierCurveTo(tailLength * 0.82, spread, tailLength * 0.35, spread * 0.75, 0, 0);
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = '#fffdf4';
  ctx.lineWidth = Math.max(0.45, length * 0.004);
  for (let i = -4; i <= 4; i++) {
    const side = i / 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(tailLength * 0.48, side * spread * 0.35, tailLength * (0.7 + Math.abs(side) * 0.22), side * spread * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarking(
  ctx: CanvasRenderingContext2D,
  renderFish: RenderFish,
  marking: Marking,
  maxHalfWidth: number,
) {
  if (marking.crown) {
    const point = sampleSpine(renderFish, marking.start);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.globalAlpha = marking.alpha;
    ctx.fillStyle = marking.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, maxHalfWidth * 0.58, maxHalfWidth * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const points = renderFish.patchPoints;
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const segment = marking.start + (marking.end - marking.start) * t;
    const point = sampleSpine(renderFish, segment);
    const bodyWidth = BODY_PROFILE[Math.min(SEGMENT_COUNT - 1, Math.round(segment))] * maxHalfWidth;
    const envelope = Math.sin(t * Math.PI);
    const side = point.angle + Math.PI * 0.5;
    const left = marking.side - marking.spread * (0.46 + envelope * 0.54);
    points[i].x = point.x + Math.cos(side) * bodyWidth * left;
    points[i].y = point.y + Math.sin(side) * bodyWidth * left;
    const rightIndex = steps * 2 - 1 - i;
    const right = marking.side + marking.spread * (0.46 + envelope * 0.54);
    points[rightIndex].x = point.x + Math.cos(side) * bodyWidth * right;
    points[rightIndex].y = point.y + Math.sin(side) * bodyWidth * right;
  }
  traceSmoothClosedCurve(ctx, points, steps * 2);
  ctx.globalAlpha = marking.alpha;
  ctx.fillStyle = marking.color;
  ctx.fill();
  ctx.globalAlpha = marking.alpha * 0.22;
  ctx.strokeStyle = marking.color;
  ctx.lineWidth = Math.max(1, maxHalfWidth * 0.12);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawFish(
  ctx: CanvasRenderingContext2D,
  renderFish: RenderFish,
  fish: Fish,
  profile: KoiProfile,
  w: number,
  h: number,
  nowMs: number,
  reducedMotion: boolean,
) {
  updateSpine(renderFish, fish, profile, w, h, nowMs);
  const depthScale = 0.88 + fish.z * 0.12;
  const length = profile.size * w * depthScale;
  const maxHalfWidth = length * 0.16;
  const count = bodyContour(renderFish, profile, fish, w);
  const finColor = profile.pattern === 'showa' || profile.body === '#1b1d22' ? '#c9ceca' : profile.body;
  const speedRatio = Math.max(0.35, fish.speed / profile.speed);
  const phase = renderFish.phase + nowMs * 0.001 * (2.5 + speedRatio * 1.7);

  // 深水魚的影子離魚更遠也更淡；雙層描邊取代昂貴 blur。
  const depth = 1 - fish.z;
  ctx.save();
  ctx.translate(4 + depth * 12, 6 + depth * 15);
  traceSmoothClosedCurve(ctx, renderFish.contour, count);
  ctx.strokeStyle = `rgba(3, 18, 20, ${0.055 + fish.z * 0.045})`;
  ctx.lineWidth = 5 + depth * 8;
  ctx.stroke();
  ctx.fillStyle = `rgba(3, 18, 20, ${0.055 + fish.z * 0.095})`;
  ctx.fill();
  ctx.restore();

  drawPairedFin(ctx, renderFish, 4, -1, length * 0.19, maxHalfWidth, finColor, phase);
  drawPairedFin(ctx, renderFish, 4, 1, length * 0.19, maxHalfWidth, finColor, phase);
  drawPairedFin(ctx, renderFish, 10, -1, length * 0.11, maxHalfWidth, finColor, phase + 0.5);
  drawPairedFin(ctx, renderFish, 10, 1, length * 0.11, maxHalfWidth, finColor, phase + 0.5);
  drawTail(ctx, renderFish, length, finColor, phase);

  const head = renderFish.spine[0];
  const headPerp = head.angle + Math.PI * 0.5;
  for (const side of [-1, 1]) {
    const x = head.x + Math.cos(head.angle) * length * 0.035 + Math.cos(headPerp) * maxHalfWidth * 0.42 * side;
    const y = head.y + Math.sin(head.angle) * length * 0.035 + Math.sin(headPerp) * maxHalfWidth * 0.42 * side;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(head.angle + side * 0.55) * length * 0.035,
      y + Math.sin(head.angle + side * 0.55) * length * 0.035,
      x + Math.cos(head.angle + side * 1.08) * length * 0.065,
      y + Math.sin(head.angle + side * 1.08) * length * 0.065,
    );
    ctx.strokeStyle = profile.pattern === 'showa' ? 'rgba(190, 186, 178, 0.55)' : 'rgba(235, 225, 206, 0.72)';
    ctx.lineWidth = Math.max(0.7, length * 0.008);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  ctx.save();
  traceSmoothClosedCurve(ctx, renderFish.contour, count);
  ctx.fillStyle = profile.body;
  ctx.fill();
  ctx.clip();
  for (const marking of renderFish.markings) drawMarking(ctx, renderFish, marking, maxHalfWidth);

  if (profile.pattern === 'solid' && profile.patches[0]) {
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = profile.patches[0];
    ctx.lineWidth = maxHalfWidth * 0.75;
    ctx.beginPath();
    ctx.moveTo(renderFish.spine[2].x, renderFish.spine[2].y);
    for (let i = 3; i <= 15; i++) ctx.lineTo(renderFish.spine[i].x, renderFish.spine[i].y);
    ctx.stroke();
  }

  traceSmoothClosedCurve(ctx, renderFish.contour, count);
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = profile.pattern === 'showa' ? '#05090b' : '#415b5a';
  ctx.lineWidth = maxHalfWidth * 0.56;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(renderFish.spine[1].x, renderFish.spine[1].y);
  for (let i = 2; i <= 15; i++) ctx.lineTo(renderFish.spine[i].x, renderFish.spine[i].y);
  const shimmer = reducedMotion ? 0 : (Math.sin(nowMs * 0.0022 + renderFish.phase) + 1) * 0.025;
  ctx.globalAlpha = (profile.body === '#e6a91c' ? 0.34 : 0.2) + shimmer;
  ctx.strokeStyle = '#fffdf4';
  ctx.lineWidth = maxHalfWidth * 0.36;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.globalAlpha = (1 - fish.z) * 0.44;
  ctx.fillStyle = WATER_VEIL;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // 背鰭沿著彎曲脊線，兩層細線形成半透明膜和鰭條感。
  ctx.beginPath();
  ctx.moveTo(renderFish.spine[5].x, renderFish.spine[5].y);
  for (let i = 6; i <= 15; i++) ctx.lineTo(renderFish.spine[i].x, renderFish.spine[i].y);
  ctx.strokeStyle = 'rgba(15, 34, 35, 0.15)';
  ctx.lineWidth = Math.max(1.2, length * 0.018);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 253, 244, 0.32)';
  ctx.lineWidth = Math.max(0.5, length * 0.0045);
  ctx.stroke();

  const eye = renderFish.spine[1];
  const eyePerp = eye.angle + Math.PI * 0.5;
  const eyeOffset = BODY_PROFILE[1] * maxHalfWidth * 0.82;
  const eyeRadius = Math.max(1, length * 0.014);
  for (const side of [-1, 1]) {
    const x = eye.x + Math.cos(eyePerp) * eyeOffset * side;
    const y = eye.y + Math.sin(eyePerp) * eyeOffset * side;
    ctx.globalAlpha = 0.68 + fish.z * 0.3;
    ctx.fillStyle = '#11191a';
    ctx.beginPath();
    ctx.ellipse(x, y, eyeRadius, eyeRadius * 0.72, eye.angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.arc(x - eyeRadius * 0.25, y - eyeRadius * 0.25, eyeRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** '#RRGGBB' → 'rgba(r, g, b, a)'；不是這個格式就原樣回傳。 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function drawReflections(
  ctx: CanvasRenderingContext2D,
  reflections: readonly Reflection[],
  dark: number,
  w: number,
  h: number,
  nowMs: number,
  reducedMotion: boolean,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const spot of reflections) {
    const sway = reducedMotion ? 0 : Math.sin(nowMs / 1800 + spot.phase) * w * 0.004;
    const cx = spot.x * w + sway;
    const cy = spot.y * h;
    const rx = Math.max(2, w * 0.008);
    const ry = Math.max(10, h * 0.045);
    // 柔光柱：透明度從中心一路往外遞減，不能有外圈比內圈亮（會變靶心）。
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 2);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    glow.addColorStop(0.3, withAlpha(spot.color, 0.4));
    glow.addColorStop(1, withAlpha(spot.color, 0));
    ctx.globalAlpha = 0.6 * dark;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 水波把倒影切成幾段橫向細光，各自輕輕左右晃。
    ctx.globalAlpha = 0.45 * dark;
    ctx.fillStyle = withAlpha(spot.color, 0.9);
    for (let k = -2; k <= 2; k++) {
      const half = rx * (2.6 - Math.abs(k) * 0.7);
      const shift = reducedMotion ? 0 : Math.sin(nowMs / 700 + spot.phase + k * 1.3) * rx;
      ctx.fillRect(cx - half + shift, cy + k * ry * 0.38, half * 2, 1.2);
    }
  }
  ctx.restore();
}

export function createKoiRenderer() {
  const renderFishById = new Map<string, RenderFish>();

  return function drawLake(
    ctx: CanvasRenderingContext2D,
    state: LakeState,
    profiles: readonly KoiProfile[],
    ripples: readonly Ripple[],
    w: number,
    h: number,
    nowMs: number,
    reducedMotion: boolean,
    rippleMs: number,
    sky?: SkyDraw,
  ) {
    ctx.clearRect(0, 0, w, h);

    for (const fish of state.fish) {
      const profile = profiles.find((item) => item.id === fish.id);
      if (!profile) continue;
      let renderFish = renderFishById.get(fish.id);
      if (!renderFish) {
        renderFish = createRenderFish(profile);
        renderFishById.set(fish.id, renderFish);
      }
      drawFish(ctx, renderFish, fish, profile, w, h, nowMs, reducedMotion);
    }

    const dark = sky ? Math.min(1, Math.max(0, sky.darkness)) : 0;
    if (dark > 0) {
      // 只蓋在已畫的魚上，水面透明處不受影響。
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(${NIGHT_RGB}, ${dark * NIGHT_MAX_ALPHA})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      drawReflections(ctx, sky!.reflections, dark, w, h, nowMs, reducedMotion);
    }

    for (const ripple of ripples) {
      const small = ripple.small === true;
      const progress = (nowMs - ripple.at) / (small ? rippleMs * 1.1 : rippleMs);
      if (progress < 0 || progress > 1) continue;
      ctx.strokeStyle = `rgba(235, 250, 245, ${(small ? 0.45 : 0.5) * (1 - progress)})`;
      ctx.lineWidth = small ? 1.2 : 1.5;
      ctx.beginPath();
      const grow = small ? 11 : 22;
      ctx.ellipse(ripple.x * w, ripple.y * h, (small ? 1.5 : 4) + progress * grow, (small ? 1 : 3) + progress * grow * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 飼料浮在水面，永遠蓋在魚上方。
    for (const pellet of state.pellets) {
      ctx.fillStyle = 'rgba(196, 150, 96, 0.95)';
      ctx.beginPath();
      ctx.arc(pellet.x * w, pellet.y * h, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
