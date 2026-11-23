/** 放大鏡與雙指縮放的純函式。座標都是畫面盒子（.pp-shell）裡的 CSS px，transform-origin 在左上角。 */
import { ZOOM_MAX } from './constants';

export interface View {
  s: number;
  tx: number;
  ty: number;
}

export const IDENTITY: View = { s: 1, tx: 0, ty: 0 };

/** 倍率限制在 1..ZOOM_MAX，位移限制在內容蓋滿畫面的範圍。 */
export function clampView(view: View, w: number, h: number): View {
  const s = Math.min(ZOOM_MAX, Math.max(1, view.s));
  const tx = Math.min(0, Math.max(w - w * s, view.tx));
  const ty = Math.min(0, Math.max(h - h * s, view.ty));
  return { s, tx, ty };
}

/** 以畫面上的 (px, py) 為定點，把倍率改成 s。 */
export function zoomAt(view: View, s: number, px: number, py: number, w: number, h: number): View {
  const cx = (px - view.tx) / view.s;
  const cy = (py - view.ty) / view.s;
  return clampView({ s, tx: px - cx * s, ty: py - cy * s }, w, h);
}

/** 把內容上的一點（未縮放座標）放到畫面中央、倍率 s。 */
export function centerOn(contentX: number, contentY: number, s: number, w: number, h: number): View {
  return clampView({ s, tx: w / 2 - contentX * s, ty: h / 2 - contentY * s }, w, h);
}

export interface Pinch {
  start: View;
  dist: number;
  midX: number;
  midY: number;
}

/** 雙指：距離比例決定倍率，起始中點對到的內容點跟著目前中點走（同時能平移）。 */
export function pinchView(pinch: Pinch, dist: number, midX: number, midY: number, w: number, h: number): View {
  const s = pinch.dist > 0 ? pinch.start.s * dist / pinch.dist : pinch.start.s;
  const clamped = Math.min(ZOOM_MAX, Math.max(1, s));
  const cx = (pinch.midX - pinch.start.tx) / pinch.start.s;
  const cy = (pinch.midY - pinch.start.ty) / pinch.start.s;
  return clampView({ s: clamped, tx: midX - cx * clamped, ty: midY - cy * clamped }, w, h);
}

export const viewTransform = (view: View) => `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
