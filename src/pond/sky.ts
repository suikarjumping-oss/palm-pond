import { RAIN_RIPPLES_PER_SEC, SUNRISE_HOUR, SUNSET_HOUR, TWILIGHT_MS } from './constants';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** 0 = 白天、1 = 深夜；日出日落前後 TWILIGHT_MS 漸變。用當地時間。 */
export function darkness(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = now.getTime();
  const sunriseAt = midnight + SUNRISE_HOUR * 3_600_000;
  const sunsetAt = midnight + SUNSET_HOUR * 3_600_000;
  if (t < sunriseAt - TWILIGHT_MS) return 1;
  if (t < sunriseAt + TWILIGHT_MS) return (sunriseAt + TWILIGHT_MS - t) / (2 * TWILIGHT_MS);
  if (t < sunsetAt - TWILIGHT_MS) return 0;
  if (t < sunsetAt + TWILIGHT_MS) return (t - sunsetAt + TWILIGHT_MS) / (2 * TWILIGHT_MS);
  return 1;
}

export function seasonOf(now: Date): Season {
  const month = now.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function rainRipplesDue(rain: number, dtMs: number, rng: () => number, reducedMotion: boolean): number {
  const expected = Math.min(1, Math.max(0, rain))
    * Math.max(0, dtMs) / 1000
    * RAIN_RIPPLES_PER_SEC
    * (reducedMotion ? 0.5 : 1);
  const whole = Math.floor(expected);
  const fraction = expected - whole;
  return whole + (fraction > 0 && rng() < fraction ? 1 : 0);
}
