import { describe, expect, it } from 'vitest';
import { ZOOM_MAX } from './constants';
import { centerOn, clampView, IDENTITY, pinchView, zoomAt } from './zoom';

describe('zoom', () => {
  it('never zooms out past the full view or leaves a gap', () => {
    expect(clampView({ s: 0.5, tx: 30, ty: 30 }, 100, 200)).toEqual(IDENTITY);
    expect(clampView({ s: 2, tx: -500, ty: 10 }, 100, 200)).toEqual({ s: 2, tx: -100, ty: 0 });
    expect(clampView({ s: 9, tx: 0, ty: 0 }, 100, 200).s).toBe(ZOOM_MAX);
  });

  it('keeps the point under the cursor fixed', () => {
    const view = zoomAt(IDENTITY, 2, 40, 60, 100, 200);
    expect((40 - view.tx) / view.s).toBeCloseTo(40);
    expect((60 - view.ty) / view.s).toBeCloseTo(60);
  });

  it('centres a content point', () => {
    const view = centerOn(50, 150, 2, 100, 200);
    expect(view.tx + 50 * view.s).toBeCloseTo(50);
    expect(view.ty + 150 * view.s).toBeCloseTo(100);
  });

  it('pinch scales by finger distance and pans with the midpoint', () => {
    const pinch = { start: IDENTITY, dist: 50, midX: 50, midY: 100 };
    const view = pinchView(pinch, 100, 40, 100, 100, 200);
    expect(view.s).toBe(2);
    expect(view.tx + 50 * view.s).toBeCloseTo(40);
  });
});
