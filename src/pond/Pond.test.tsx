import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pond from './Pond';
import { SITE_TITLE } from './constants';
import { createPondStore, type KeyValue, type PondStore } from './store';

const HINT = '點水面撒一點飼料';
const NOW = () => new Date(2026, 10, 21, 12, 0);

function memoryStore(): PondStore {
  const data = new Map<string, string>();
  const kv: KeyValue = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
  return createPondStore(kv);
}

describe('Pond', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the title and a first-visit hint that goes away after feeding', () => {
    const store = memoryStore();
    const feed = vi.spyOn(store, 'feed');
    render(<Pond store={store} now={NOW} />);
    expect(screen.getByRole('heading', { name: SITE_TITLE })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    const water = screen.getByLabelText('池面，點一下撒飼料');
    fireEvent.pointerDown(water, { clientX: 2, clientY: 2 });
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0][0]).toBe('2026-11-21');
  });

  it('records a feed day only once per visit day', () => {
    const store = memoryStore();
    const feed = vi.spyOn(store, 'feed');
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(5000);
    render(<Pond store={store} now={NOW} />);
    const water = screen.getByLabelText('池面，點一下撒飼料');
    fireEvent.pointerDown(water, { clientX: 2, clientY: 2 });
    fireEvent.pointerDown(water, { clientX: 3, clientY: 3 });
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it('has no back button or rename form', () => {
    render(<Pond store={memoryStore()} now={NOW} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
