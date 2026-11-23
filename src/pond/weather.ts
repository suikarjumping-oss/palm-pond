/** 隨機天氣：不連網、不看地點。同一個當地時段（WEATHER_BLOCK_HOURS）結果固定，重新整理不會跳。 */
import { WEATHER_BLOCK_HOURS, WEATHER_TABLE } from './constants';
import { localDateKey } from './dates';
import { mulberry32 } from './engine';

export interface PondEnv {
  windiness: number;
  rain: number;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function weatherAt(now: Date): PondEnv {
  const block = Math.floor(now.getHours() / WEATHER_BLOCK_HOURS);
  const rng = mulberry32(hash(`${localDateKey(now)}#${block}`));
  const roll = rng();
  let sum = 0;
  let row = WEATHER_TABLE[0];
  for (const entry of WEATHER_TABLE) {
    sum += entry.chance;
    row = entry;
    if (roll < sum) break;
  }
  const lerp = ([min, max]: [number, number]) => min + rng() * (max - min);
  return { windiness: lerp(row.wind), rain: lerp(row.rain) };
}
