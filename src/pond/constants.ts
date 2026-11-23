/**
 * 池子（錦鯉）的所有可調數字。
 * 改玩法先改這裡；engine.ts 不寫死任何數字。
 * 湖面座標一律正規化成 0..1（x 往右、y 往下），長度單位是「湖寬」，時間單位 ms（速度、轉向是每秒）。
 */

export interface KoiProfile {
  /** 'koi-1' ... 不顯示。 */
  id: string;
  /** 暫名。 */
  name: string;
  /** 底色 CSS color。 */
  body: string;
  /** 花斑顏色，0–2 個。 */
  patches: string[];
  /** 錦鯉品種花紋。 */
  pattern: 'kohaku' | 'sanke' | 'showa' | 'tancho' | 'solid' | 'asagi';
  /** 身長，相對湖寬，0.10–0.175。 */
  size: number;
  /** 巡游速度，湖寬/秒，0.03–0.08。 */
  speed: number;
  /** 0..1：看到飼料多快反應、會不會擠開別隻。 */
  boldness: number;
  /** 0..1：吃幾顆才飽、飽了多久不再搶。 */
  appetite: number;
  /** 畫花斑的固定種子；DB id 改變時仍保留原本外觀。 */
  markSeed?: string | number;
}

export const FRY_START = 0.4;
export const GROW_DAYS = 30;
export const MAX_FISH = 12;

export const KOI_PROFILES: readonly KoiProfile[] = [
  { id: 'koi-1', name: '小紅', body: '#f4f1ea', patches: ['#d8321f', '#e8502c'], pattern: 'kohaku', size: 0.15, speed: 0.06, boldness: 0.95, appetite: 0.7 },
  { id: 'koi-2', name: '三花', body: '#f6f2ea', patches: ['#d8321f', '#2a2a2e'], pattern: 'sanke', size: 0.16, speed: 0.05, boldness: 0.6, appetite: 0.5 },
  { id: 'koi-3', name: '墨墨', body: '#26262b', patches: ['#d8321f', '#f4f1ea'], pattern: 'showa', size: 0.14, speed: 0.055, boldness: 0.45, appetite: 0.4 },
  { id: 'koi-4', name: '金寶', body: '#e6a91c', patches: ['#f2c94c'], pattern: 'solid', size: 0.175, speed: 0.04, boldness: 0.7, appetite: 1 },
  { id: 'koi-5', name: '銀雪', body: '#e9ecef', patches: [], pattern: 'solid', size: 0.125, speed: 0.07, boldness: 0.5, appetite: 0.3 },
  { id: 'koi-6', name: '烏龍', body: '#1b1d22', patches: [], pattern: 'solid', size: 0.16, speed: 0.035, boldness: 0.3, appetite: 0.6 },
  { id: 'koi-7', name: '奶茶', body: '#f1dd9a', patches: ['#f6ecc4'], pattern: 'solid', size: 0.11, speed: 0.075, boldness: 0.2, appetite: 0.2 },
  { id: 'koi-8', name: '藍莓', body: '#9fb2c4', patches: ['#c6d3df'], pattern: 'asagi', size: 0.1, speed: 0.065, boldness: 0.1, appetite: 0.35 },
];

/**
 * 湖面對到底圖（koi-lake.webp，941×1672）上的範圍，單位是底圖寬／高的百分比。換底圖只要重量這組。
 * 上緣 43% 是枯山水與棧道下方的水邊；左右各留 9%，因為手機比底圖窄，兩側會被裁掉一點。
 */
export const WATER_BOUNDS = { left: 9, top: 43, width: 82, height: 55 } as const;
/** 大雨每秒產生的漣漪數。 */
export const RAIN_RIPPLES_PER_SEC = 18;
/** 夜色最深的不透明度。 */
export const NIGHT_MAX_ALPHA = 0.6;
/** 日出日落前後的漸變時間。 */
export const TWILIGHT_MS = 30 * 60 * 1000;

/** 湖面正規化座標的上下界。 */
export const LAKE_MIN = 0;
export const LAKE_MAX = 1;

/** 轉向上限，弧度/秒。 */
export const MAX_TURN_RATE = 4;
/** 單步時間上限 ms：分頁切回來不會瞬移。 */
export const MAX_DT_MS = 100;
/** 魚離湖邊的邊距 = 身長 × 這個數（一半）。 */
export const EDGE_MARGIN_FACTOR = 0.5;
/** 離巡游目標這麼近就算到了，換下一個。 */
export const WANDER_ARRIVE_DIST = 0.03;
/** 飼料離湖邊的最小距離（≥ 最大身長的一半，魚才吃得到）。 */
export const PELLET_EDGE_MARGIN = 0.09;

/** 一次撒幾顆。 */
export const PELLETS_PER_TOSS = 5;
/** 飼料散開半徑。 */
export const TOSS_SPREAD = 0.05;
/** 飼料沒被吃多久後沉下去消失。 */
export const PELLET_LIFETIME_MS = 8000;
/** 同時最多幾顆，超過丟掉最舊的。 */
export const MAX_PELLETS = 30;
/** 兩次撒飼料的最短間隔（給畫面用）。 */
export const TOSS_COOLDOWN_MS = 600;

/** 反應時間 = REACT_BASE_MS × (1 - boldness) + rng × REACT_JITTER_MS。 */
export const REACT_BASE_MS = 1200;
export const REACT_JITTER_MS = 800;
/** 沒在反應中的 reactAt 值。 */
export const NOT_REACTING = -1;
/** 追飼料時速度倍率。 */
export const CHASE_SPEED_MULT = 2.2;
/** 追飼料時離飼料這麼近開始減速，避免繞圈吃不到。 */
export const CHASE_SLOW_DIST = 0.1;
/** 減速的最低倍率。 */
export const CHASE_SLOW_MIN = 0.35;
/** 離飼料 < 身長 × 這個數就吃掉。 */
export const EAT_RADIUS_FACTOR = 0.4;
/** 吃滿 ceil(appetite × MAX_BITES) 顆就飽。 */
export const MAX_BITES = 4;
/** 飽了多久不再搶。 */
export const FULL_MS = 15000;

/** 平常巡游的最深水位。 */
export const Z_MIN = 0.42;
/** 平常巡游的最淺水位。 */
export const Z_MAX = 0.88;
/** 追飼料時靠近水面的水位。 */
export const CHASE_Z = 0.96;
/** 受驚時下潛的水位。 */
export const FLEE_Z = 0.28;
/** 深度靠近目標的緩動速度（每秒）。 */
export const DEPTH_EASE = 0.9;
/** 深度接近目標到這個距離就換一個巡游水位。 */
export const DEPTH_ARRIVE_DIST = 0.02;
/** 強風時巡游水位下移的距離。 */
export const WIND_DEPTH_SHIFT = 0.22;
/** 強風時反應時間增加的倍率。 */
export const WIND_REACT_MULT = 1.5;
/** 強風時上浮速度減少的比例。 */
export const WIND_RISE_SLOW = 0.5;

/** 角速度靠近目標角速度的緩動速度（每秒）。 */
export const TURN_EASE = 3.2;
/** 巡游時最多使用轉向上限的比例。 */
export const CRUISE_TURN_FACTOR = 0.38;
/** 追飼料時最多使用轉向上限的比例。 */
export const CHASE_TURN_FACTOR = 0.82;
/** 方向誤差轉成目標角速度的倍率。 */
export const TURN_RESPONSE = 2.4;
/** 速度靠近目標速度的緩動速度（每秒）。 */
export const SPEED_EASE = 2.2;
/** 巡游速度上下起伏的比例。 */
export const CRUISE_VARIATION = 0.07;
/** 一輪巡游速度起伏的時間 ms。 */
export const CRUISE_VARIATION_MS = 16500;

/** 兩隻魚深度差小於這個值才互相閃開。 */
export const SEPARATION_DZ = 0.2;
/** 魚距離小於身長乘這個倍率就互相閃開。 */
export const SEPARATION_FACTOR = 0.9;
/** 閃開方向混入主要方向的強度。 */
export const SEPARATION_STRENGTH = 0.75;
/** 進入離岸這個距離後開始柔和轉向湖心。 */
export const BANK_SOFT_ZONE = 0.14;
/** 湖心方向混入主要方向的強度。 */
export const BANK_STRENGTH = 1.15;

/** 指標速度低於這個值會吸引魚（湖寬/秒）。 */
export const POINTER_SLOW = 0.55;
/** 慢指標吸引魚的半徑。 */
export const POINTER_ATTRACT_R = 0.48;
/** 慢指標吸引方向的最大強度。 */
export const POINTER_ATTRACT_STRENGTH = 1.2;
/** 被慢指標吸引時的速度倍率。 */
export const POINTER_ATTRACT_SPEED_MULT = 1.15;
/** 指標速度高於這個值會嚇跑魚（湖寬/秒）。 */
export const POINTER_FAST = 1.25;
/** 快指標嚇跑魚的半徑。 */
export const POINTER_FLEE_R = 0.34;
/** 魚受驚後逃跑的時間 ms。 */
export const FLEE_MS = 1250;
/** 魚受驚時的速度倍率。 */
export const FLEE_SPEED_MULT = 2.65;

/** 夜色（rgb），alpha 另乘 NIGHT_MAX_ALPHA × darkness。 */
export const NIGHT_RGB = '10, 18, 40';
/** 倒影最多畫最新幾顆光點。 */
export const REFLECTION_MAX = 30;
/** 倒影在湖座標的範圍。 */
export const REFLECTION_X_MIN = 0.08;
export const REFLECTION_X_MAX = 0.92;
export const REFLECTION_Y_MIN = 0.02;
export const REFLECTION_Y_MAX = 0.45;
/** 天色重算間隔。 */
export const SKY_REFRESH_MS = 60 * 1000;

/** 網頁名稱；改名只改這裡和 index.html 的 <title>／og:title。 */
export const SITE_TITLE = '半畝塘';

/** 新生小魚的名字，依序抽還沒用過的；用完了就加編號。 */
export const FRY_NAMES: readonly string[] = [
  '抹茶', '柚子', '紅葉', '白玉', '羊羹', '銀杏', '櫻餅', '小豆',
  '黑糖', '葛餅', '八橋', '柿子', '桔梗', '山茶', '湯葉', '金平糖',
];

/** 生小魚：最近 7 天至少餵 3 天、7 天內沒生過、魚少於 MAX_FISH，再擲 1/3。 */
export const SPAWN_WINDOW_DAYS = 7;
export const SPAWN_MIN_FEED_DAYS = 3;
export const SPAWN_CHANCE = 1 / 3;
/** 魚多於這個數才有魚出門。 */
export const AWAY_MIN_FISH = 4;

/** 天氣：每幾小時換一次（同一段時間內大家重新整理都一樣）。 */
export const WEATHER_BLOCK_HOURS = 3;
/** 天氣機率表，依序累加；windiness／rain 都是 0..1。 */
export const WEATHER_TABLE: readonly { chance: number; wind: [number, number]; rain: [number, number] }[] = [
  { chance: 0.62, wind: [0, 0], rain: [0, 0] },          // 無風無雨
  { chance: 0.18, wind: [0.25, 0.55], rain: [0, 0] },    // 起風
  { chance: 0.12, wind: [0.05, 0.3], rain: [0.15, 0.45] }, // 小雨
  { chance: 0.06, wind: [0.35, 0.7], rain: [0.75, 1] },  // 大雨
  { chance: 0.02, wind: [0.85, 1], rain: [0.3, 0.6] },   // 風雨
];

/** 沒有真實日出日落，固定用當地時間 6:00／18:00。 */
export const SUNRISE_HOUR = 6;
export const SUNSET_HOUR = 18;

/** 夜裡水面上的燈籠倒影數量與顏色。 */
export const LANTERN_COUNT = 9;
export const LANTERN_COLORS: readonly string[] = ['#ffb35c', '#ff9248', '#ffd27a', '#f47a4a', '#ffe3a3'];

/** 新生小魚的提示顯示多久。 */
export const NEWBORN_NOTICE_MS = 4000;

/** 放大：最大倍率、按鈕一按的倍率、動畫時間。 */
export const ZOOM_MAX = 3;
export const ZOOM_BUTTON = 1.8;
export const ZOOM_ANIM_MS = 350;
/** 滑鼠滾輪每格的縮放比例。 */
export const ZOOM_WHEEL_STEP = 0.0015;
