/**
 * Движок интеллектуального планирования отгрузки (v1 — только расчёт).
 *
 * delivery_time заявки = время прибытия на объект.
 * Приоритет парка: свои → частота прошлых рейсов → объём бочки.
 * Режимы: full_day | stage (не затирает locked/done).
 */

import { isOutsideBryansk, isPickupOrder } from '@/lib/bryanskAddress';

export { isPickupOrder } from '@/lib/bryanskAddress';
import { formatTimeHHMM, pluralRu } from '@/lib/ruLocale';
import {
  applyRoadCalibrationFactor,
  resolveJoinBufferMinutes,
  resolveLoadMinutes,
  resolveUnloadMinutes,
  type PlannerCalibration,
} from '@/lib/plannerCalibration';

/**
 * Свои миксеры «городской радиус»: только г. Брянск и не дальше LOCAL_RADIUS_MAX_KM
 * от завода. Маркеры — нормализованный хвост госномера (кириллица→латиница).
 * К332КК32 → 332KK32, О021УХ32 → 021YX32.
 */
export const LOCAL_RADIUS_MIXER_MARKERS = ['332KK32', '021YX32'] as const;
/** Макс. дорожное расстояние от завода (км), как в travel-time v2. */
export const LOCAL_RADIUS_MAX_KM = 30;
/** Как в app/api/adminCifra/travel-time (формула v2). */
const TRAVEL_AVG_SPEED_KMH = 55;

/**
 * Заявки 11–12 м³ — один рейс большой бочкой.
 * Свой миксер 285 (О285ЕХ32 и т.п.) или наём с бочкой ≥ остатка, если он в парке дня.
 */
export const PREFERRED_12M3_OWN_MARKERS = ['285'] as const;
const LARGE_SINGLE_LOAD_VOL_MIN = 10.95;
const LARGE_SINGLE_LOAD_VOL_MAX = 12.05;

const PLATE_LOOKALIKES_PLANNER: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

function normalizePlannerPlate(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/ё/g, 'Е')
    .replace(/[\s\-_.]/g, '')
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => PLATE_LOOKALIKES_PLANNER[ch] || ch);
}

/** Миксер 332 / 021 — только ближние заявки по Брянску. */
export function isLocalRadiusMixer(mixerNumber: string): boolean {
  const key = normalizePlannerPlate(mixerNumber);
  return LOCAL_RADIUS_MIXER_MARKERS.some((m) => key.includes(m));
}

/** Свой 12-кубовый 285 — приоритет на заявки 11–12 м³. */
export function isPreferred12m3OwnMixer(mixerNumber: string): boolean {
  const key = normalizePlannerPlate(mixerNumber);
  return PREFERRED_12M3_OWN_MARKERS.some((m) => key.includes(m));
}

/** Объём заявки «ровно под одну большую бочку» (11–12 м³). */
export function isLargeSingleLoadOrderVolume(volumeM3: number): boolean {
  const v = Number(volumeM3) || 0;
  return v >= LARGE_SINGLE_LOAD_VOL_MIN && v <= LARGE_SINGLE_LOAD_VOL_MAX;
}

/**
 * Кандидат на заявку 11–12 м³: свой 285 или наём с бочкой ≥ остатка (≥11).
 * Только из уже выбранного парка дня (caller фильтрует список).
 */
export function isPreferredLargeSingleLoadMixer(
  mixer: Pick<PlannerMixer, 'number' | 'volume' | 'type'>,
  remainingVolume: number,
): boolean {
  const cap = Number(mixer.volume) || 0;
  const need = Math.max(0, Number(remainingVolume) || 0);
  if (need <= 0.05 || cap + 0.05 < need) return false;
  if (isPreferred12m3OwnMixer(mixer.number)) return true;
  if (String(mixer.type) === 'rented' && cap >= 11) return true;
  return false;
}

/** Оценка дорожного км из road_time_min (обратная к travel-time v2). */
export function estimateDeliveryRoadKm(roadMin: number | null | undefined): number {
  return (Math.max(0, Number(roadMin) || 0) * TRAVEL_AVG_SPEED_KMH) / 60;
}

/** Заявка подходит под «городской радиус» (г. Брянск и ≤30 км по дороге). */
export function isLocalRadiusOrderEligible(
  order: { address?: string | null; roadMin?: number | null },
  opts?: { pickup?: boolean },
): boolean {
  if (opts?.pickup) return true;
  if (isOutsideBryansk(order.address)) return false;
  return estimateDeliveryRoadKm(order.roadMin) <= LOCAL_RADIUS_MAX_KM + 0.05;
}

/**
 * Можно ли ставить миксер с ограничением радиуса на эту заявку.
 * Самовывоз (на заводе) — всегда ок. Иначе: не «за городом» и ≤30 км по дороге.
 */
export function mixerAllowedForPlannerOrder(
  mixerNumber: string,
  order: { address?: string | null; roadMin?: number | null },
  opts?: { pickup?: boolean },
): boolean {
  if (!isLocalRadiusMixer(mixerNumber)) return true;
  return isLocalRadiusOrderEligible(order, opts);
}

/**
 * Активная калибровка на время planLogistics / связанных хелперов.
 * Снаружи файла — null → дефолтные нормы V1.
 */
let activePlannerCalibration: PlannerCalibration | null = null;

function withPlannerCalibration<T>(
  calib: PlannerCalibration | null | undefined,
  fn: () => T,
): T {
  const prev = activePlannerCalibration;
  activePlannerCalibration = calib ?? null;
  try {
    return fn();
  } finally {
    activePlannerCalibration = prev;
  }
}

function joinBufferMinutes(): number {
  return resolveJoinBufferMinutes(activePlannerCalibration);
}

/**
 * Занятие соски на БСУ: подъезд + заливка + промывка, мин на рейс.
 * Было ~20 мин (volume×2 на дашборде) / слишком коротко при rate=2 м³/мин.
 * Диспетчер: реально укладываемся в ~15 мин.
 */
export const PLANT_LOAD_SLOT_MIN = 15;

/** @deprecated используй PLANT_LOAD_SLOT_MIN — оставлено для старых импортов. */
export const LOAD_RATE_M3_PER_MIN = 1;

/**
 * Разгрузка на объекте для ПЛАНА (не путать с unload_allowance / простоем).
 * 50–60 мин «нормы простоя» раздували цикл и оставляли хвост до ночи.
 */
export const PLANNER_UNLOAD_MIN = 35;

/** @deprecated → PLANNER_UNLOAD_MIN */
export const DEFAULT_UNLOAD_MIN = PLANNER_UNLOAD_MIN;

/** Буфер стыка непрерывной заливки одной заявки, мин. */
export const TRIP_JOIN_BUFFER_MIN = 5;

/**
 * Темп заливки для стыка рейсов, мин/м³.
 * Важно: следующий миксер едет к концу ЗАЛИВКИ объёма, а не к полному
 * «простою на объекте» (35 мин). Иначе хвост 9 м³ «не влезает», хотя
 * последний рейс уже дома в 20:48.
 */
export const POUR_RATE_MIN_PER_M3 = 2;

/**
 * Насколько раньше цели можно прибыть на объект (мин).
 * Грузим чуть заранее, если соска свободна — иначе очередь вечером и return > 21:00.
 * Бетон в пути+ожидании не дольше ~этого окна сверх JIT.
 */
export const MAX_EARLY_ARRIVE_MIN = 25;

/**
 * Обычное открытие БСУ (если нет ранних доставок).
 * Фактическое окно дня считает `resolvePlantOpenMinutes` — при доставке к 06:00
 * грузим раньше, чтобы успеть на объект.
 */
export const PLANT_OPEN_DEFAULT_MINUTES = 6 * 60;

/** @deprecated → PLANT_OPEN_DEFAULT_MINUTES; для совместимости = дефолт 06:00 */
export const PLANT_OPEN_MINUTES = PLANT_OPEN_DEFAULT_MINUTES;

/** Нижняя граница раннего открытия (не раньше 04:00). */
export const PLANT_OPEN_EARLIEST_MINUTES = 4 * 60;

/**
 * К этому времени (без «Включая ночь») миксер должен быть на базе.
 * returnTime ≤ 21:00.
 */
export const PLANT_CLOSE_RETURN_MINUTES = 21 * 60;

/**
 * Открытие соски под самые ранние заявки дня.
 * Доставка к 06:00 + дорога/погрузка → старт раньше дефолтных 06:00.
 */
export function resolvePlantOpenMinutes(
  orders: PlannerOrder[],
  opts?: {
    useTraffic?: boolean;
    arriveOverrides?: Record<string, string>;
  },
): number {
  let open = PLANT_OPEN_DEFAULT_MINUTES;
  const useTraffic = Boolean(opts?.useTraffic);
  const overrides = opts?.arriveOverrides || {};

  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const goal = parseHhMm(overrides[String(o.id)] || o.deliveryTime);
    if (goal == null) continue;
    const vol = Number(o.volume) || 0;
    if (vol <= 0.05) continue;

    const firstChunk = Math.min(vol, 12);
    const loadMin = loadMinutesForVolume(firstChunk);

    if (isPickupOrder(o.address)) {
      // Готовность к цели → погрузка начинается не позже goal − loadMin.
      const need = goal - loadMin;
      if (need < open) open = need;
      continue;
    }

    const baseRoad = Math.max(5, Number(o.roadMin) || 30);
    const roadGuess = roadWithTraffic(baseRoad, goal - baseRoad, useTraffic);
    const idealLoad = goal - roadGuess - loadMin;
    const earliestLoad = idealLoad - MAX_EARLY_ARRIVE_MIN;
    if (earliestLoad < open) open = earliestLoad;
  }

  return Math.max(PLANT_OPEN_EARLIEST_MINUTES, Math.round(open));
}

/** Подпись окна для баннеров/Макс: «05:20–21:00» или дефолт. */
export function formatPlantWindowLabel(
  plantOpenMinutes: number,
  allowNight = false,
): string {
  if (allowNight) return 'включая ночь';
  const openLabel = formatMinutes(plantOpenMinutes);
  const early =
    plantOpenMinutes < PLANT_OPEN_DEFAULT_MINUTES
      ? ` (рано: есть доставки к утру)`
      : '';
  return `в окне ${openLabel}–21:00 (возврат ≤ 21:00)${early}`;
}

/** Макс. сдвиг цели прибытия в варианте B, мин. */
export const MAX_ARRIVE_SHIFT_MINUTES = 60;

/**
 * Множители «пробок» по часу суток (Брянск, эвристика без внешнего API).
 * Индекс = час 0…23. База 1.0 = свободная дорога (как в road_time_min).
 * Утро 7–9 и вечер 16–18 — пик; ночь/день — ближе к 1.
 */
export const TRAFFIC_HOUR_MULTIPLIERS: readonly number[] = [
  1.0, // 0
  1.0, // 1
  1.0, // 2
  1.0, // 3
  1.0, // 4
  1.0, // 5
  1.05, // 6
  1.25, // 7
  1.35, // 8
  1.25, // 9
  1.1, // 10
  1.05, // 11
  1.1, // 12
  1.1, // 13
  1.05, // 14
  1.1, // 15
  1.2, // 16
  1.35, // 17
  1.3, // 18
  1.15, // 19
  1.05, // 20
  1.0, // 21
  1.0, // 22
  1.0, // 23
];

/** Множитель пробок в абсолютных минутах от полуночи дня плана. */
export function trafficMultiplierAt(absMin: number): number {
  if (!Number.isFinite(absMin)) return 1;
  const DAY = 24 * 60;
  let inDay = absMin % DAY;
  if (inDay < 0) inDay += DAY;
  const hour = Math.min(23, Math.floor(inDay / 60));
  return TRAFFIC_HOUR_MULTIPLIERS[hour] ?? 1;
}

/** Базовая дорога × пробки (если включены). Минимум 5 мин. + V2 calib. */
export function roadWithTraffic(
  baseRoadMin: number,
  atAbsMin: number,
  useTraffic: boolean,
): number {
  const base = Math.max(5, Number(baseRoadMin) || 30);
  const withTraffic = useTraffic
    ? Math.max(5, Math.round(base * trafficMultiplierAt(atAbsMin)))
    : base;
  const mult = useTraffic ? trafficMultiplierAt(atAbsMin) : 1;
  return applyRoadCalibrationFactor(
    withTraffic,
    mult > 1.05,
    activePlannerCalibration,
  );
}

/** Окно истории частоты рейсов, дней. */
export const FLEET_HISTORY_DAYS = 60;

/**
 * Мягкий ориентир только для buildFleetHint (первая раскладка объёма).
 * НЕ лимит движка: planLogistics ставит миксеру столько рейсов, сколько
 * влезает в окно 06–21 (хоть 5–7), пока return ≤ 21:00.
 */
export const DEFAULT_TRIPS_PER_MIXER_DAY = 5;

/** Маркер рейса-слота самовывоза (не миксер парка). */
export const PICKUP_MIXER_NUMBER = 'самовывоз';

/** Макс. кусок на соске для самовывоза, если парк не выбран (м³). */
const PICKUP_DEFAULT_CHUNK_M3 = 12;

export type PlannerMode = 'full_day' | 'stage';

export type PlannerOrder = {
  id: number | string;
  client: string;
  deliveryTime: string; // HH:MM прибытие
  volume: number;
  address: string;
  grade?: string;
  status?: string;
  /** Минут в пути завод → объект */
  roadMin: number;
};

export type PlannerMixer = {
  id: number | string;
  number: string;
  volume: number;
  type: 'own' | 'rented' | string;
  unloadMin?: number | null;
  /** Число завершённых рейсов за окно истории */
  tripCount?: number;
  /** Сумма м³ за окно истории */
  volumeSum?: number;
};

export type PlannedTrip = {
  id: string;
  orderId: number | string;
  client: string;
  mixerNumber: string;
  mixerId: number | string;
  volume: number;
  /** HH:MM начало загрузки на БСУ (после полуночи — «HH:MM (+1д)») */
  loadTime: string;
  /** HH:MM прибытие на объект (для самовывоза — когда соска будет готова) */
  arriveTime: string;
  /** HH:MM окончание разгрузки (оценка) */
  unloadDoneTime: string;
  /** HH:MM возврат на базу (оценка); для самовывоза — «—» */
  returnTime: string;
  /** Абсолютные минуты от полуночи дня плана (могут быть > 24ч) — для сортировки. */
  loadAtMin?: number;
  arriveAtMin?: number;
  returnAtMin?: number;
  roadMin: number;
  loadMin: number;
  unloadMin: number;
  locked?: boolean;
  done?: boolean;
  /** Клиент забирает сам — слот соски без занятости миксера парка */
  pickup?: boolean;
  /** Id волны дня (Фаза 4), в которой рейс появился/сдвинули */
  waveId?: string;
  /**
   * Задержка диспетчера (мин) поверх нормы разгрузки — звонок водителя
   * «разгрузят час вместо 30». Удлиняет возврат миксера → хвост переезжает.
   */
  delayMin?: number;
  /**
   * Жёсткая 1:1 связка с order_mixers.id после «Применить в заявки»
   * или устойчивого матча факта (Фаза 5 closed-loop).
   */
  orderMixerId?: number | null;
};

/** Волна дня: План дня / Этап N / сдвиг рейса (Фаза 4). */
export type PlannerWave = {
  id: string;
  /** 0 = утро (весь день), 1+ = этапы; сдвиги могут делить index с текущим этапом */
  index: number;
  label: string;
  mode: 'full_day' | 'stage' | 'shift';
  createdAt: string;
  createdByName?: string | null;
  tripCount: number;
  newTripCount: number;
  /** Медиана опоздания (мин), учтённая при этапе */
  delayFactMin?: number;
  tripIds: string[];
  summary?: string;
  /** V2: какие нормы использовались при расчёте волны */
  calibrationSource?: {
    days: number;
    samples: number;
    loadP50: number | null;
    unloadP50: number | null;
    active: boolean;
  };
};

export type PlannerWarning = {
  level: 'warn' | 'error';
  message: string;
};

export type FleetHint = {
  totalVolume: number;
  /** Число рейсов (не машин). */
  suggestedTripCount: number;
  /** Сколько уникальных миксеров задействует ориентир. */
  suggestedMixerCount: number;
  ownMixerCount: number;
  rentedMixerCount: number;
  /** @deprecated используй suggestedTripCount */
  suggestedCount: number;
  volumes: number[];
  text: string;
  uncoveredVolume: number;
};

export type PlanLogisticsInput = {
  mode: PlannerMode;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  /** Уже зафиксированные / отработанные рейсы — не пересчитываем */
  lockedTrips?: PlannedTrip[];
  /** Заявки, полностью отработанные — исключаем из нарезки */
  doneOrderIds?: Array<number | string>;
  /** Если задано — в этап только заявки с deliveryTime <= until */
  stageUntilTime?: string | null;
  /** Разрешить return после 21:00 и рейсы на следующие сутки */
  allowNight?: boolean;
  /**
   * Учитывать матрицу пробок по часу суток (без внешнего API).
   * Удлиняет road_time_min в часы пик.
   */
  useTraffic?: boolean;
  /**
   * Переопределение цели прибытия по заявке (HH:MM) — для варианта B со сдвигами.
   * Ключ — String(orderId).
   */
  arriveOverrides?: Record<string, string>;
  /**
   * Фактическое опоздание соски/выпуска (мин) — сдвигает цели незакрытых заявок
   * на этапе, чтобы хвост не строился в «оптимистичное» прошлое.
   */
  factDelayMin?: number;
  /**
   * «Сейчас» (минуты от полуночи) — для mode=stage: новые загрузки не раньше этого
   * момента. Иначе свободные миксеры снова встают на утренний JIT (09:00 при клике в 15:00).
   */
  nowMinutes?: number | null;
  /** V2: нормы из истории план↔факт (load/road/unload/join). */
  calibration?: PlannerCalibration | null;
};

export type PlanLogisticsResult = {
  trips: PlannedTrip[];
  newTrips: PlannedTrip[];
  warnings: PlannerWarning[];
  fleetHint: FleetHint;
  maxText: string;
  /** Фактическое открытие БСУ в этот расчёт (может быть раньше 06:00). */
  plantOpenMinutes: number;
  /** Заявки, по которым не удалось поставить все рейсы в окно */
  uncoveredOrderIds: string[];
  uncoveredVolume: number;
  /** План укладывается в окно (нет непокрытого объёма) */
  fitsWindow: boolean;
  allowNight: boolean;
};

export type PlannerScenarioId = 'A' | 'B' | 'C';

export type PlannerOrderShift = {
  orderId: string;
  from: string;
  to: string;
  deltaMin: number;
};

export type PlannerScenario = {
  id: PlannerScenarioId;
  title: string;
  summary: string;
  mixerIds: string[];
  mixers: PlannerMixer[];
  trips: PlannedTrip[];
  warnings: PlannerWarning[];
  fleetHint: FleetHint;
  uncoveredOrderIds: string[];
  uncoveredVolume: number;
  tripCount: number;
  mixerCount: number;
  rentedCount: number;
  maxShiftMin: number;
  orderShifts: PlannerOrderShift[];
  allowNight: boolean;
  fitsWindow: boolean;
  /** Подсказка включить ночь, если без неё не закрыть */
  nightHint?: string;
};

/** Парсит «HH:MM» или «HH:MM (+1д)» в минуты от полуночи дня плана. */
function parseHhMm(t: string): number | null {
  const m = String(t || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)д\))?/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const dayOffset = Number(m[3] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return dayOffset * 24 * 60 + h * 60 + min;
}

/**
 * Минуты → «HH:MM». Если ушли за полночь — «HH:MM (+1д)»,
 * иначе ночные рейсы выглядят как утро того же дня и сортируются вверх списка.
 */
function formatMinutes(total: number): string {
  if (!Number.isFinite(total)) return '—';
  const DAY = 24 * 60;
  const dayOffset = Math.floor(total / DAY);
  let inDay = total % DAY;
  if (inDay < 0) inDay += DAY;
  const h = Math.floor(inDay / 60);
  const m = Math.floor(inDay % 60);
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return dayOffset > 0 ? `${base} (+${dayOffset}д)` : base;
}

/**
 * Границы дня по рейсам превью/плана: первая погрузка → последний возврат
 * (для самовывоза — готовность на БСУ). Больше миксеров → обычно раньше finish.
 */
export function getPlanDayBounds(trips: PlannedTrip[]): {
  startMin: number | null;
  finishMin: number | null;
  startLabel: string | null;
  finishLabel: string | null;
} {
  let start = Infinity;
  let finish = -Infinity;
  for (const t of trips) {
    const load = t.loadAtMin ?? parseHhMm(t.loadTime);
    if (load != null && load < start) start = load;
    const isPu = Boolean(t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER);
    const end = isPu
      ? (t.arriveAtMin ?? parseHhMm(t.arriveTime) ?? load)
      : (t.returnAtMin ?? parseHhMm(t.returnTime));
    if (end != null && end > finish) finish = end;
  }
  if (!Number.isFinite(start) || start === Infinity) {
    return {
      startMin: null,
      finishMin: null,
      startLabel: null,
      finishLabel: null,
    };
  }
  const finishMin =
    Number.isFinite(finish) && finish > -Infinity ? finish : null;
  return {
    startMin: start,
    finishMin,
    startLabel: formatMinutes(start),
    finishLabel: finishMin != null ? formatMinutes(finishMin) : null,
  };
}

function tripLoadSortKey(t: PlannedTrip): number {
  if (t.loadAtMin != null && Number.isFinite(t.loadAtMin)) return t.loadAtMin;
  return parseHhMm(t.loadTime) ?? 0;
}

/**
 * Время на соске: дефолт ~12–18 мин; при активной V2-калибровке — из истории.
 */
export function loadMinutesForVolume(volumeM3: number): number {
  return resolveLoadMinutes(volumeM3, activePlannerCalibration);
}

/**
 * Разгрузка для планирования рейса.
 * Не используем unload_allowance (норма простоя для штрафов) — она 50+ мин и ломает день.
 * V2: при калибровке — P50 факта (20–45).
 */
export function unloadMinutesForMixer(_m: PlannerMixer): number {
  return resolveUnloadMinutes(activePlannerCalibration);
}

/** Ранг парка: свои → история → объём бочки. */
export function rankFleetForDay(mixers: PlannerMixer[]): PlannerMixer[] {
  return [...mixers].sort((a, b) => {
    const ownA = a.type === 'own' ? 1 : 0;
    const ownB = b.type === 'own' ? 1 : 0;
    if (ownB !== ownA) return ownB - ownA;
    const tripsA = Number(a.tripCount || 0);
    const tripsB = Number(b.tripCount || 0);
    if (tripsB !== tripsA) return tripsB - tripsA;
    const volHistA = Number(a.volumeSum || 0);
    const volHistB = Number(b.volumeSum || 0);
    if (volHistB !== volHistA) return volHistB - volHistA;
    return Number(b.volume || 0) - Number(a.volume || 0);
  });
}

/**
 * Грубая подсказка парка по объёму (не финальный план).
 * maxTripsPerMixer — только порядок раскладки («сначала по ~N рейсов на машину»),
 * потом шаг 2 спокойно даёт 5–7+ рейсов. Жёсткого потолка нет.
 */
export function buildFleetHint(
  orders: PlannerOrder[],
  mixers: PlannerMixer[],
  maxTripsPerMixer = DEFAULT_TRIPS_PER_MIXER_DAY,
  allowNight = false,
  opts?: { useTraffic?: boolean; plantOpenMinutes?: number },
): FleetHint {
  const active = orders.filter((o) => o.status !== 'cancelled');
  const plantOpen =
    opts?.plantOpenMinutes ??
    resolvePlantOpenMinutes(active, { useTraffic: opts?.useTraffic });
  const windowLabel = formatPlantWindowLabel(plantOpen, allowNight);
  const pickupVolume =
    Math.round(
      active
        .filter((o) => isPickupOrder(o.address))
        .reduce((s, o) => s + (Number(o.volume) || 0), 0) * 10,
    ) / 10;
  const totalVolume =
    Math.round(active.reduce((s, o) => s + (Number(o.volume) || 0), 0) * 10) / 10;
  // Парк считаем только по доставке — самовывоз занимает соску, не миксеры.
  const deliveryVolume =
    Math.round((totalVolume - pickupVolume) * 10) / 10;
  const ranked = rankFleetForDay(mixers.filter((m) => Number(m.volume) > 0));
  const volumes: number[] = [];
  const used: PlannerMixer[] = [];
  const tripsByMixer = new Map<string, number>();
  let left = deliveryVolume;

  const addTrip = (m: PlannerMixer, chunk: number) => {
    volumes.push(chunk);
    left = Math.round((left - chunk) * 10) / 10;
    const key = String(m.id);
    const n = (tripsByMixer.get(key) || 0) + 1;
    tripsByMixer.set(key, n);
    if (n === 1) used.push(m);
  };

  // 1) Свои и часто ездившие — сначала по ~maxTripsPerMixer рейсов.
  for (const m of ranked) {
    if (left <= 0.05) break;
    const cap = Number(m.volume) || 0;
    if (cap <= 0) continue;
    let trips = 0;
    while (left > 0.05 && trips < maxTripsPerMixer) {
      const chunk = Math.min(cap, Math.round(left * 10) / 10);
      addTrip(m, chunk);
      trips += 1;
    }
  }

  // 2) Сверх ориентира — сколько угодно рейсов на уже взятых (5–7+ нормально),
  //    пока объём не закроется; свои раньше наёмных.
  let guard = 0;
  while (left > 0.05 && used.length > 0 && guard < 80) {
    guard += 1;
    let progressed = false;
    for (const m of used) {
      if (left <= 0.05) break;
      const cap = Number(m.volume) || 0;
      if (cap <= 0) continue;
      addTrip(m, Math.min(cap, Math.round(left * 10) / 10));
      progressed = true;
    }
    if (!progressed) break;
  }

  // 3) Крайний случай — виртуальные рейсы 8 м³ (парк не задан / пуст).
  while (left > 0.05 && volumes.length < 80) {
    const chunk = Math.min(8, Math.ceil(left * 10) / 10);
    volumes.push(chunk);
    left = Math.round((left - chunk) * 10) / 10;
  }

  const uncoveredVolume = Math.max(0, Math.round(left * 10) / 10);
  const suggestedTripCount = volumes.length;
  const suggestedMixerCount = used.length || (suggestedTripCount > 0 ? Math.ceil(suggestedTripCount / maxTripsPerMixer) : 0);
  const ownMixerCount = used.filter((m) => m.type === 'own').length;
  const rentedMixerCount = Math.max(0, suggestedMixerCount - ownMixerCount);
  const volsText = volumes.map((v) => `${v}`).join('+');
  const tripsWord = pluralRu(suggestedTripCount, 'рейс', 'рейса', 'рейсов');
  const mixersWord = pluralRu(suggestedMixerCount, 'миксер', 'миксера', 'миксеров');

  let text: string;
  if (totalVolume <= 0) {
    text = 'На день нет объёма для планирования.';
  } else if (pickupVolume > 0.05 && deliveryVolume <= 0.05) {
    text =
      `На день только самовывоз ${pickupVolume} м³ — миксеры парка не нужны, ` +
      `учитывается занятость соски. ${windowLabel}.`;
  } else if (suggestedTripCount === 0) {
    text = `План ${totalVolume} м³ — выбери миксеры в расчёт.`;
  } else {
    const fleetBits: string[] = [];
    if (ownMixerCount > 0) fleetBits.push(`${ownMixerCount} своих`);
    if (rentedMixerCount > 0) fleetBits.push(`${rentedMixerCount} наёмных`);
    const fleetPart =
      suggestedMixerCount > 0
        ? ` на ${suggestedMixerCount} ${mixersWord}` +
          (fleetBits.length ? ` (${fleetBits.join(', ')})` : '')
        : '';
    text =
      `Ориентир: ${suggestedTripCount} ${tripsWord}${fleetPart}` +
      ` — объёмы рейсов ${volsText} м³ (доставка ${deliveryVolume} м³` +
      (pickupVolume > 0.05 ? ` + самовывоз ${pickupVolume} м³` : '') +
      `). ${windowLabel}.` +
      ` Рейсов на миксер — сколько влезет в окно (часто 4–6); приоритет свои и часто ездившие.`;
    if (pickupVolume > 0.05) {
      text += ` Самовывоз — только занятость соски, без миксеров.`;
    }
    if (uncoveredVolume > 0) {
      text += ` Не хватает ~${uncoveredVolume} м³.`;
    }
  }

  return {
    totalVolume,
    suggestedTripCount,
    suggestedMixerCount,
    ownMixerCount,
    rentedMixerCount,
    suggestedCount: suggestedTripCount,
    volumes,
    text,
    uncoveredVolume,
  };
}

/**
 * Факт по готовому плану: сколько рейсов/миксеров реально в trips,
 * а не эвристика «~3 рейса на машину» (она занижает парк в окне 06–21).
 */
export function fleetHintFromPlan(
  trips: PlannedTrip[],
  orders: PlannerOrder[],
  mixers: PlannerMixer[],
  allowNight = false,
  extras?: {
    uncoveredVolume?: number;
    useTraffic?: boolean;
    plantOpenMinutes?: number;
  },
): FleetHint {
  const plantOpen =
    extras?.plantOpenMinutes ??
    resolvePlantOpenMinutes(orders, { useTraffic: extras?.useTraffic });
  const windowLabel = formatPlantWindowLabel(plantOpen, allowNight);
  const totalVolume =
    Math.round(orders.reduce((s, o) => s + (Number(o.volume) || 0), 0) * 10) / 10;
  const pickupTrips = trips.filter(
    (t) => t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER,
  );
  const deliveryTrips = trips.filter(
    (t) => !t.pickup && t.mixerNumber !== PICKUP_MIXER_NUMBER,
  );
  const pickupVolume =
    Math.round(
      pickupTrips.reduce((s, t) => s + (Number(t.volume) || 0), 0) * 10,
    ) / 10;
  const volumes = deliveryTrips.map((t) => Number(t.volume) || 0);
  const byNumber = new Map(mixers.map((m) => [m.number, m]));
  const usedNumbers = [...new Set(deliveryTrips.map((t) => t.mixerNumber))];
  let ownMixerCount = 0;
  let rentedMixerCount = 0;
  for (const num of usedNumbers) {
    const m = byNumber.get(num);
    if (m?.type === 'rented') rentedMixerCount += 1;
    else ownMixerCount += 1;
  }
  const suggestedTripCount = deliveryTrips.length;
  const suggestedMixerCount = usedNumbers.length;
  const uncoveredVolume = Math.max(0, Number(extras?.uncoveredVolume) || 0);
  const volsText = volumes.map((v) => `${v}`).join('+');
  const tripsWord = pluralRu(suggestedTripCount, 'рейс', 'рейса', 'рейсов');
  const mixersWord = pluralRu(suggestedMixerCount, 'миксер', 'миксера', 'миксеров');

  let text: string;
  if (suggestedTripCount === 0 && pickupTrips.length === 0) {
    text =
      totalVolume > 0
        ? `План ${totalVolume} м³ — рейсов в расчёте пока нет.`
        : 'На день нет объёма для планирования.';
  } else if (suggestedTripCount === 0 && pickupTrips.length > 0) {
    text =
      `План: самовывоз ${pickupVolume} м³ (${pickupTrips.length} ` +
      `${pluralRu(pickupTrips.length, 'слот', 'слота', 'слотов')} на соске, без миксеров). ` +
      `${windowLabel}.`;
  } else {
    const fleetBits: string[] = [];
    if (ownMixerCount > 0) fleetBits.push(`${ownMixerCount} своих`);
    if (rentedMixerCount > 0) fleetBits.push(`${rentedMixerCount} наёмных`);
    text =
      `План: ${suggestedTripCount} ${tripsWord} на ${suggestedMixerCount} ${mixersWord}` +
      (fleetBits.length ? ` (${fleetBits.join(', ')})` : '') +
      ` — объёмы рейсов ${volsText} м³ (заказ ${totalVolume} м³` +
      (pickupVolume > 0.05 ? `, из них самовывоз ${pickupVolume} м³` : '') +
      `). ${windowLabel}.` +
      (extras?.useTraffic
        ? ' Пробки: матрица по часу (утро/вечер ×1.25–1.35).'
        : '');
    if (pickupVolume > 0.05) {
      text += ` Самовывоз — только соска.`;
    }
    if (uncoveredVolume > 0.05) {
      text += ` Не влезает ~${uncoveredVolume} м³.`;
    }
  }

  return {
    totalVolume,
    suggestedTripCount,
    suggestedMixerCount,
    ownMixerCount,
    rentedMixerCount,
    suggestedCount: suggestedTripCount,
    volumes,
    text,
    uncoveredVolume,
  };
}

/**
 * Выбрать миксер на следующий кусок заявки.
 * Кусок = min(остаток, бочка) — нельзя резать всё по максимальной 12 м³,
 * иначе 6–8 м³ машины отбрасываются и крутится одна двенадцатика.
 * Порядок: кто раньше свободен (+ балансировка рейсов) → меньше пустоты в бочке
 * → меньшая бочка раньше большей (6 м³ в 6-куб, хвост 4 — в крупный) → ранг.
 * Для заявок 11–12 м³ сначала пробуем свой 285 / наём с подходящей бочкой.
 */
function pickMixerForChunk(
  rankedMixers: PlannerMixer[],
  mixerBusy: Map<string, number>,
  nextArrive: number,
  remainingVolume: number,
  opts?: {
    allowNight?: boolean;
    /** Базовая дорога без пробок */
    baseRoadMin?: number;
    useTraffic?: boolean;
    excludeNumbers?: Set<string>;
    /** Сколько рейсов уже назначено в текущем расчёте */
    tripCounts?: Map<string, number>;
    /** Открытие БСУ на этот день (с учётом ранних доставок) */
    plantOpenMinutes?: number;
    /** Адрес заявки — для ограничения 332/021 */
    orderAddress?: string | null;
    /** Самовывоз — радиус не проверяем */
    orderPickup?: boolean;
    /**
     * Заявка 11–12 м³: сначала свой 285 / наём с подходящей бочкой
     * (если они в парке дня и свободны в окне).
     */
    preferLargeSingleLoad?: boolean;
  },
): PlannerMixer | null {
  const allowNight = opts?.allowNight ?? false;
  const baseRoad = opts?.baseRoadMin ?? 30;
  const useTraffic = Boolean(opts?.useTraffic);
  const exclude = opts?.excludeNumbers;
  const tripCounts = opts?.tripCounts;
  const plantOpen = opts?.plantOpenMinutes ?? PLANT_OPEN_DEFAULT_MINUTES;
  const preferLarge = Boolean(opts?.preferLargeSingleLoad);
  const orderForRadius = {
    address: opts?.orderAddress,
    roadMin: baseRoad,
  };
  const orderPickup = Boolean(opts?.orderPickup);
  // Штраф за уже назначенные рейсы (~интервал стыка): иначе верх рейтинга
  // забирает все слоты, а 8-й выбранный миксер сидит без рейса.
  const LOAD_BALANCE_PENALTY_MIN = 12;
  /** В этом окне готовность «примерно равна» — решает посадка по объёму бочки. */
  const READY_TOLERANCE_MIN = 15;
  /** Среди приоритетных 12-кубов свой 285 раньше найма. */
  const LARGE_PREF_OWN = 0;
  const LARGE_PREF_RENTED = 1;

  type Cand = {
    mixer: PlannerMixer;
    readyScore: number;
    unused: number;
    cap: number;
    rank: number;
    largePref: number;
  };
  let bestMixer: PlannerMixer | null = null;
  let bestReady = Infinity;
  let bestUnused = Infinity;
  let bestCap = Infinity;
  let bestRank = Infinity;
  let bestLargePref = Infinity;

  const takeIfBetter = (cand: Cand) => {
    const a = cand;
    const better =
      !bestMixer ||
      a.largePref < bestLargePref ||
      (a.largePref === bestLargePref &&
        (a.readyScore < bestReady - READY_TOLERANCE_MIN ||
          (!(bestReady < a.readyScore - READY_TOLERANCE_MIN) &&
            (a.unused + 0.05 < bestUnused ||
              (!(bestUnused + 0.05 < a.unused) &&
                (a.cap + 0.05 < bestCap ||
                  (!(bestCap + 0.05 < a.cap) &&
                    (a.readyScore < bestReady ||
                      (a.readyScore === bestReady && a.rank < bestRank)))))))));
    if (!better) return;
    bestMixer = a.mixer;
    bestReady = a.readyScore;
    bestUnused = a.unused;
    bestCap = a.cap;
    bestRank = a.rank;
    bestLargePref = a.largePref;
  };

  const consider = (
    onlyWithinWindow: boolean,
    allowOrphan: boolean,
    onlyPreferredLarge: boolean,
  ) => {
    rankedMixers.forEach((m, rank) => {
      if (exclude?.has(m.number)) return;
      if (
        !mixerAllowedForPlannerOrder(m.number, orderForRadius, {
          pickup: orderPickup,
        })
      ) {
        return;
      }
      if (
        onlyPreferredLarge &&
        !isPreferredLargeSingleLoadMixer(m, remainingVolume)
      ) {
        return;
      }
      const cap = Number(m.volume) || 0;
      if (cap <= 0.05) return;
      const vol = Math.min(remainingVolume, cap);
      if (vol <= 0.05) return;
      const rem = Math.round((remainingVolume - vol) * 10) / 10;
      // Не оставляем «хвост» 0.1–1.9 м³ отдельным рейсом, если есть альтернатива.
      if (!allowOrphan && rem > 0.05 && rem < 2) return;
      const loadMin = loadMinutesForVolume(vol);
      const unloadMin = unloadMinutesForMixer(m);
      // Черновая дорога по часу цели — уточним после ready.
      const roadGuess = roadWithTraffic(baseRoad, nextArrive - baseRoad, useTraffic);
      const idealLoad = nextArrive - roadGuess - loadMin;
      const earliestLoad = idealLoad - MAX_EARLY_ARRIVE_MIN;
      const freeFrom = mixerBusy.get(m.number) ?? -Infinity;
      const ready = Math.max(freeFrom, plantOpen, earliestLoad);
      const roadOut = roadWithTraffic(baseRoad, ready, useTraffic);
      const arrive = ready + loadMin + roadOut;
      const unloadStart = Math.max(arrive, nextArrive);
      // Возврат — по полному времени на объекте; стык со следующим — по темпу заливки.
      const unloadDone = unloadStart + unloadMin;
      const roadBack = roadWithTraffic(baseRoad, unloadDone, useTraffic);
      const returnAt = unloadDone + roadBack;
      if (onlyWithinWindow && !allowNight && returnAt > PLANT_CLOSE_RETURN_MINUTES) {
        return;
      }
      const trips = tripCounts?.get(m.number) ?? 0;
      const unused = Math.round((cap - vol) * 10) / 10;
      let largePref = 50;
      if (onlyPreferredLarge || preferLarge) {
        if (isPreferred12m3OwnMixer(m.number)) largePref = LARGE_PREF_OWN;
        else if (String(m.type) === 'rented' && cap >= 11) largePref = LARGE_PREF_RENTED;
        else if (!onlyPreferredLarge) largePref = 40;
      }
      takeIfBetter({
        mixer: m,
        readyScore: ready + trips * LOAD_BALANCE_PENALTY_MIN,
        unused,
        cap,
        rank,
        largePref,
      });
    });
  };

  const runPasses = (onlyPreferredLarge: boolean) => {
    consider(true, false, onlyPreferredLarge);
    if (!bestMixer) consider(true, true, onlyPreferredLarge);
    if (!bestMixer && allowNight) {
      consider(false, false, onlyPreferredLarge);
      if (!bestMixer) consider(false, true, onlyPreferredLarge);
    }
  };

  // 11–12 м³: сначала 285 / подходящий найм, иначе обычный подбор.
  if (preferLarge) runPasses(true);
  if (!bestMixer) runPasses(false);
  return bestMixer;
}

/**
 * После набора рейсов заявки — переложить объёмы на бочки best-fit:
 * крупные куски → в наименьшую подходящую бочку (6 м³ в 6-куб, хвост 4 — в более крупный).
 */
function rebalanceOrderVolumesToMixerCaps(
  trips: PlannedTrip[],
  orderId: number | string,
  mixers: PlannerMixer[],
): void {
  const idxs: number[] = [];
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    if (String(t.orderId) !== String(orderId)) continue;
    if (t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER) continue;
    if (t.locked || t.done) continue;
    idxs.push(i);
  }
  if (idxs.length < 2) return;

  const capOf = (t: PlannedTrip): number => {
    const m = mixers.find(
      (x) => x.number === t.mixerNumber || String(x.id) === String(t.mixerId),
    );
    return Number(m?.volume) || Number(t.volume) || 0;
  };

  const volumes = idxs
    .map((i) => Number(trips[i].volume) || 0)
    .sort((a, b) => b - a);
  const slots = idxs
    .map((i) => ({ i, cap: capOf(trips[i]) }))
    .sort((a, b) => a.cap - b.cap || a.i - b.i);

  const assigned = new Map<number, number>();
  const usedSlots = new Set<number>();
  for (const vol of volumes) {
    const slot = slots.find((s) => !usedSlots.has(s.i) && s.cap + 0.05 >= vol);
    if (!slot) return;
    usedSlots.add(slot.i);
    assigned.set(slot.i, vol);
  }
  if (assigned.size !== idxs.length) return;

  for (const i of idxs) {
    const vol = assigned.get(i);
    if (vol == null) continue;
    const t = trips[i];
    if (Math.abs(Number(t.volume) - vol) < 0.05) continue;
    t.volume = vol;
    t.loadMin = loadMinutesForVolume(vol);
  }
}

type BusyInterval = { start: number; end: number };

function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

function isSlotFree(
  intervals: BusyInterval[],
  start: number,
  duration: number,
): boolean {
  const candidate = { start, end: start + duration };
  return !intervals.some((iv) => overlaps(iv, candidate));
}

/**
 * Ищет свободный старт в [from, until] с шагом 5 мин (без записи в intervals).
 * Нужен, чтобы подтянуть погрузку раньше JIT только в реально свободное окно.
 */
function findFreeLoadInWindow(
  intervals: BusyInterval[],
  from: number,
  until: number,
  duration: number,
): number | null {
  if (until < from) return null;
  let t = from;
  let guard = 0;
  while (t <= until && guard < 200) {
    guard += 1;
    if (isSlotFree(intervals, t, duration)) return t;
    const candidate = { start: t, end: t + duration };
    const hit = intervals.find((iv) => overlaps(iv, candidate));
    t = hit ? hit.end : t + 5;
  }
  return null;
}

function pushNoOverlap(
  intervals: BusyInterval[],
  desiredStart: number,
  duration: number,
): { start: number; end: number; shifted: boolean } {
  let start = desiredStart;
  let shifted = false;
  const endOf = (s: number) => s + duration;
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const candidate = { start, end: endOf(start) };
    const hit = intervals.find((iv) => overlaps(iv, candidate));
    if (!hit) {
      intervals.push(candidate);
      intervals.sort((x, y) => x.start - y.start);
      return { start, end: candidate.end, shifted };
    }
    start = hit.end;
    shifted = true;
  }
  const fallback = { start, end: endOf(start) };
  intervals.push(fallback);
  return { start, end: fallback.end, shifted: true };
}

/** Если в массиве уже есть одинаковые id — переименовать хвост, не теряя рейсы. */
export function uniquifyPlannedTripIds(trips: PlannedTrip[]): PlannedTrip[] {
  const seen = new Set<string>();
  let n = 0;
  let changed = false;
  const next = trips.map((t) => {
    const base = t.id || `plan-anon`;
    if (!seen.has(base)) {
      seen.add(base);
      return t.id ? t : { ...t, id: base };
    }
    changed = true;
    n += 1;
    let id = `${base}-dup${n}`;
    while (seen.has(id)) {
      n += 1;
      id = `${base}-dup${n}`;
    }
    seen.add(id);
    return { ...t, id };
  });
  return changed ? next : trips;
}

export function planLogistics(input: PlanLogisticsInput): PlanLogisticsResult {
  return withPlannerCalibration(input.calibration, () => planLogisticsInner(input));
}

function planLogisticsInner(input: PlanLogisticsInput): PlanLogisticsResult {
  const locked = [...(input.lockedTrips || [])];
  const doneSet = new Set((input.doneOrderIds || []).map(String));
  const warnings: PlannerWarning[] = [];
  const allowNight = Boolean(input.allowNight);
  const useTraffic = Boolean(input.useTraffic);
  const overrides: Record<string, string> = { ...(input.arriveOverrides || {}) };
  const factDelayMin = Math.max(0, Math.round(Number(input.factDelayMin) || 0));
  const uncoveredOrderIds = new Set<string>();
  let uncoveredVolume = 0;

  // Предварительный список заявок — чтобы сдвинуть цели на factDelayMin.
  const preActive = input.orders
    .filter((o) => o.status !== 'cancelled')
    .filter((o) => !doneSet.has(String(o.id)));
  if (factDelayMin > 0) {
    for (const o of preActive) {
      const key = String(o.id);
      const base = overrides[key] || o.deliveryTime;
      const m = parseHhMm(base);
      if (m == null) continue;
      overrides[key] = formatMinutes(m + factDelayMin);
    }
    warnings.push({
      level: 'warn',
      message: `Учтено опоздание факта ~${factDelayMin} мин — цели прибытия хвоста сдвинуты.`,
    });
  }

  const activeOrders = preActive
    .filter((o) => {
      if (input.mode !== 'stage' || !input.stageUntilTime) return true;
      const until = parseHhMm(input.stageUntilTime);
      const t = parseHhMm(overrides[String(o.id)] || o.deliveryTime);
      if (until == null || t == null) return true;
      return t <= until;
    })
    .sort((a, b) => {
      const ta = parseHhMm(overrides[String(a.id)] || a.deliveryTime) ?? 0;
      const tb = parseHhMm(overrides[String(b.id)] || b.deliveryTime) ?? 0;
      return ta - tb;
    });

  const selectedMixers = rankFleetForDay(
    input.mixers.filter((m) => Number(m.volume) > 0),
  );
  // Открытие БСУ под ранние доставки (к 06:00 → грузим с 05:xx).
  const plantOpen = resolvePlantOpenMinutes(activeOrders, {
    useTraffic,
    arriveOverrides: overrides,
  });
  // Этап днём: пол загрузки = max(открытие БСУ, сейчас). Полный день — только plantOpen.
  const nowMinRaw = Number(input.nowMinutes);
  const loadFloor =
    input.mode === 'stage' && Number.isFinite(nowMinRaw)
      ? Math.max(plantOpen, Math.floor(nowMinRaw))
      : plantOpen;
  if (
    input.mode === 'stage' &&
    loadFloor > plantOpen &&
    !warnings.some((w) => w.message.startsWith('Этап от текущего времени:'))
  ) {
    warnings.push({
      level: 'warn',
      message:
        `Этап от текущего времени: новые загрузки не раньше ${formatMinutes(loadFloor)}.`,
    });
  }
  if (
    plantOpen < PLANT_OPEN_DEFAULT_MINUTES &&
    !warnings.some((w) => w.message.startsWith('Ранние доставки:'))
  ) {
    warnings.push({
      level: 'warn',
      message:
        `Ранние доставки: соска с ${formatMinutes(plantOpen)} ` +
        `(дефолт 06:00 сдвинут, чтобы успеть к цели).`,
    });
  }
  const fleetHint = buildFleetHint(
    input.orders.filter((o) => o.status !== 'cancelled' && !doneSet.has(String(o.id))),
    selectedMixers,
    DEFAULT_TRIPS_PER_MIXER_DAY,
    allowNight,
    { useTraffic, plantOpenMinutes: plantOpen },
  );

  const emptyResult = (extra?: Partial<PlanLogisticsResult>): PlanLogisticsResult => ({
    trips: locked,
    newTrips: [],
    warnings,
    fleetHint,
    maxText: formatPlanForMax(locked, warnings, fleetHint, input.mode, input.orders, {
      allowNight,
      useTraffic,
      plantOpenMinutes: plantOpen,
    }),
    plantOpenMinutes: plantOpen,
    uncoveredOrderIds: [...uncoveredOrderIds],
    uncoveredVolume,
    fitsWindow: uncoveredVolume <= 0.05 && uncoveredOrderIds.size === 0,
    allowNight,
    ...extra,
  });

  const hasDeliveryOrders = activeOrders.some(
    (o) => !isPickupOrder(o.address) && (Number(o.volume) || 0) > 0.05,
  );
  const hasPickupOrders = activeOrders.some(
    (o) => isPickupOrder(o.address) && (Number(o.volume) || 0) > 0.05,
  );
  if (selectedMixers.length === 0 && hasDeliveryOrders && !hasPickupOrders) {
    warnings.push({
      level: 'error',
      message: 'Не выбрано ни одного миксера с объёмом бочки.',
    });
    for (const o of activeOrders) {
      uncoveredOrderIds.add(String(o.id));
      uncoveredVolume += Number(o.volume) || 0;
    }
    return emptyResult();
  }
  if (selectedMixers.length === 0 && hasDeliveryOrders) {
    warnings.push({
      level: 'error',
      message:
        'Не выбрано ни одного миксера — доставку не считаю. Самовывоз ставлю только на соску.',
    });
    for (const o of activeOrders) {
      if (isPickupOrder(o.address)) continue;
      uncoveredOrderIds.add(String(o.id));
      uncoveredVolume += Number(o.volume) || 0;
    }
    // Дальше считаем только самовывоз (слоты соски).
  }

  const mixerBusy = new Map<string, number>();
  const tripCounts = new Map<string, number>();
  const nozzle: BusyInterval[] = [];
  // id новых рейсов: plan-{order}-{mixer}-{seq}. seq сбрасывается на каждый
  // вызов planLogistics, а locked сохраняют старые id → без учёта занятых
  // ключей появляются дубли (React: same key).
  const usedTripIds = new Set<string>();
  for (const t of locked) {
    if (t.id) usedTripIds.add(t.id);
  }
  let seq = 0;
  const allocTripId = (orderId: string | number, mixerKey: string): string => {
    seq += 1;
    let id = `plan-${orderId}-${mixerKey}-${seq}`;
    while (usedTripIds.has(id)) {
      seq += 1;
      id = `plan-${orderId}-${mixerKey}-${seq}`;
    }
    usedTripIds.add(id);
    return id;
  };
  for (const t of locked) {
    const loadStart = t.loadAtMin ?? parseHhMm(t.loadTime);
    const ret = t.returnAtMin ?? parseHhMm(t.returnTime);
    if (loadStart != null && t.loadMin > 0) {
      nozzle.push({ start: loadStart, end: loadStart + t.loadMin });
    }
    const isPickup =
      t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER;
    // Самовывоз занимает соску, но не парк.
    if (!isPickup && ret != null) {
      const prev = mixerBusy.get(t.mixerNumber) ?? -Infinity;
      mixerBusy.set(t.mixerNumber, Math.max(prev, ret));
    }
    if (!isPickup) {
      tripCounts.set(
        t.mixerNumber,
        (tripCounts.get(t.mixerNumber) || 0) + 1,
      );
    }
  }
  nozzle.sort((a, b) => a.start - b.start);

  const newTrips: PlannedTrip[] = [];

  /** Кусок на соске для самовывоза — по макс. бочке выбранного парка. */
  const pickupChunkCap = Math.max(
    PICKUP_DEFAULT_CHUNK_M3,
    ...selectedMixers.map((m) => Number(m.volume) || 0),
  );

  // Объём уже зафиксированных рейсов по заявке.
  // Sticky (orderMixerId) обычно уже вычтен из order.volume через applyLiveFact —
  // повторно не трогаем. Чистый план без связки с live — вычитаем здесь,
  // иначе этап/сдвиг хвоста дублирует объём locked-головы.
  const lockedExtraVolByOrder = new Map<string, number>();
  for (const t of locked) {
    if (t.orderMixerId != null) continue;
    const oid = String(t.orderId);
    lockedExtraVolByOrder.set(
      oid,
      (lockedExtraVolByOrder.get(oid) || 0) + (Number(t.volume) || 0),
    );
  }

  for (const order of activeOrders) {
    const goalLabel = overrides[String(order.id)] || order.deliveryTime;
    const arriveTarget = parseHhMm(goalLabel);
    if (arriveTarget == null) {
      warnings.push({
        level: 'warn',
        message: `Заявка #${order.id}: нет времени прибытия — пропуск.`,
      });
      uncoveredOrderIds.add(String(order.id));
      uncoveredVolume += Number(order.volume) || 0;
      continue;
    }
    const lockedExtra = lockedExtraVolByOrder.get(String(order.id)) || 0;
    let left =
      Math.round(((Number(order.volume) || 0) - lockedExtra) * 10) / 10;
    if (left <= 0.05) continue;

    // ——— Самовывоз: только слоты соски, без миксеров парка ———
    if (isPickupOrder(order.address)) {
      let nextReady = arriveTarget;
      let firstChunk = true;
      let guardPu = 0;
      while (left > 0.05 && guardPu < 80) {
        guardPu += 1;
        const volume = Math.min(left, pickupChunkCap);
        const loadMin = loadMinutesForVolume(volume);
        // К времени заявки бетон должен быть готов → грузим к (цель − loadMin).
        let desiredLoad = Math.max(loadFloor, nextReady - loadMin);
        const slot = pushNoOverlap(nozzle, desiredLoad, loadMin);
        const loadStart = slot.start;
        const readyAt = loadStart + loadMin;
        if (!allowNight && readyAt > PLANT_CLOSE_RETURN_MINUTES) {
          const idx = nozzle.findIndex(
            (iv) => iv.start === slot.start && iv.end === slot.end,
          );
          if (idx >= 0) nozzle.splice(idx, 1);
          warnings.push({
            level: 'warn',
            message:
              `Заявка #${order.id} (самовывоз): не удалось закрыть ${left.toFixed(1)} м³ ` +
              `на соске до 21:00. Включи «Включая ночь» или сдвинь время.`,
          });
          uncoveredOrderIds.add(String(order.id));
          uncoveredVolume += left;
          left = 0;
          break;
        }
        if (firstChunk && readyAt > arriveTarget + 2) {
          warnings.push({
            level: 'warn',
            message:
              `Заявка #${order.id} (самовывоз): готовность ~${formatMinutes(readyAt)} ` +
              `позже цели ${goalLabel} — очередь на соске.`,
          });
        }
        newTrips.push({
          id: allocTripId(order.id, 'pickup'),
          orderId: order.id,
          client: order.client,
          mixerNumber: PICKUP_MIXER_NUMBER,
          mixerId: 'pickup',
          volume,
          loadTime: formatMinutes(loadStart),
          arriveTime: formatMinutes(readyAt),
          unloadDoneTime: formatMinutes(readyAt),
          returnTime: '—',
          loadAtMin: loadStart,
          arriveAtMin: readyAt,
          returnAtMin: readyAt,
          roadMin: 0,
          loadMin,
          unloadMin: 0,
          locked: false,
          done: false,
          pickup: true,
        });
        left = Math.round((left - volume) * 10) / 10;
        // Следующий кусок — сразу после готовности предыдущего (клиент на БСУ).
        nextReady = readyAt + joinBufferMinutes();
        firstChunk = false;
      }
      continue;
    }

    const baseRoadMin = Math.max(5, Number(order.roadMin) || 30);

    // 332 / 021 — только г. Брянск и ≤30 км: предупредим один раз, если режем.
    if (
      selectedMixers.some((m) => isLocalRadiusMixer(m.number)) &&
      !isLocalRadiusOrderEligible(
        { address: order.address, roadMin: baseRoadMin },
        { pickup: false },
      )
    ) {
      const km = Math.round(estimateDeliveryRoadKm(baseRoadMin));
      const why = isOutsideBryansk(order.address)
        ? 'адрес вне г. Брянск'
        : `~${km} км от завода (>${LOCAL_RADIUS_MAX_KM} км)`;
      warnings.push({
        level: 'warn',
        message:
          `Заявка #${order.id}: ${why} — миксеры 332 и 021 в расчёт не ставим.`,
      });
    }

    let nextArrive = arriveTarget;
    let placedVol = 0;
    let firstTrip = true;
    let guard = 0;

    while (left > 0.05 && guard < 80) {
      guard += 1;
      const excludeNumbers = new Set<string>();
      let placed = false;

      for (let attempt = 0; attempt < selectedMixers.length; attempt++) {
        const mixer = pickMixerForChunk(
          selectedMixers,
          mixerBusy,
          nextArrive,
          left,
          {
            allowNight,
            baseRoadMin,
            useTraffic,
            excludeNumbers,
            tripCounts,
            // Этап: floor = max(открытие БСУ, сейчас), иначе скоринг снова тянет к утру.
            plantOpenMinutes: loadFloor,
            orderAddress: order.address,
            orderPickup: false,
            // 11–12 м³ одним рейсом: приоритет 285 / наём с бочкой ≥ остатка.
            preferLargeSingleLoad:
              isLargeSingleLoadOrderVolume(order.volume) && left >= 10.5,
          },
        );
        if (!mixer) break;

        const volume = Math.min(left, Number(mixer.volume) || 0);
        if (volume <= 0.05) {
          excludeNumbers.add(mixer.number);
          continue;
        }
        const loadMin = loadMinutesForVolume(volume);
        const unloadMin = unloadMinutesForMixer(mixer);

        // По умолчанию грузим по JIT (к стыку/цели). Раньше — только если
        // соска реально свободна. Иначе все рейсы с 06:00 встают в очередь
        // и сыплются ложные «сдвиги с утра».
        const roadGuess = roadWithTraffic(
          baseRoadMin,
          nextArrive - baseRoadMin,
          useTraffic,
        );
        const idealLoad = nextArrive - roadGuess - loadMin;
        const earliestLoad = Math.max(
          loadFloor,
          idealLoad - MAX_EARLY_ARRIVE_MIN,
        );
        let desiredLoad = Math.max(loadFloor, idealLoad);

        const freeFrom = mixerBusy.get(mixer.number) ?? -Infinity;
        const earlyFrom = Math.max(earliestLoad, freeFrom === -Infinity ? earliestLoad : freeFrom);
        if (earlyFrom < desiredLoad) {
          const earlySlot = findFreeLoadInWindow(
            nozzle,
            earlyFrom,
            desiredLoad,
            loadMin,
          );
          if (earlySlot != null) desiredLoad = earlySlot;
        }

        let delayedByMixer = false;
        if (desiredLoad < freeFrom) {
          desiredLoad = freeFrom;
          delayedByMixer = true;
        }
        // После early-slot / freeFrom всё равно не уходим в прошлое дня.
        if (desiredLoad < loadFloor) desiredLoad = loadFloor;

        const slot = pushNoOverlap(nozzle, desiredLoad, loadMin);

        const loadStart = slot.start;
        const roadOut = roadWithTraffic(baseRoadMin, loadStart, useTraffic);
        const arrive = loadStart + loadMin + roadOut;
        // Непрерывная заливка: разгрузка не раньше цели стыка (ранний приезд = ожидание на объекте).
        const unloadStart = Math.max(arrive, nextArrive);
        const unloadDone = unloadStart + unloadMin;
        const roadBack = roadWithTraffic(baseRoadMin, unloadDone, useTraffic);
        const returnAt = unloadDone + roadBack;
        const roadMin = roadOut;

        if (!allowNight && returnAt > PLANT_CLOSE_RETURN_MINUTES) {
          const idx = nozzle.findIndex(
            (iv) => iv.start === slot.start && iv.end === slot.end,
          );
          if (idx >= 0) nozzle.splice(idx, 1);
          excludeNumbers.add(mixer.number);
          continue;
        }

        // Замечания только когда заливка реально уехала с стыка/цели — не каждый
        // штатный разъезд на соске.
        const lateJoin = unloadStart > nextArrive + 2;
        if (delayedByMixer && lateJoin) {
          warnings.push({
            level: 'warn',
            message: `Миксер ${mixer.number}: занят до ${formatMinutes(freeFrom)} — сдвиг рейса по заявке #${order.id}.`,
          });
        }
        if (slot.shifted && lateJoin) {
          warnings.push({
            level: 'warn',
            message: `Очередь на соске: ${mixer.number} по заявке #${order.id} сдвинут на ${formatMinutes(slot.start)}.`,
          });
        }
        if (firstTrip && unloadStart > arriveTarget + 2) {
          warnings.push({
            level: 'warn',
            message: `Заявка #${order.id}: прибытие/заливка ~${formatMinutes(unloadStart)} позже цели ${goalLabel}.`,
          });
        }

        newTrips.push({
          id: allocTripId(order.id, mixer.number),
          orderId: order.id,
          client: order.client,
          mixerNumber: mixer.number,
          mixerId: mixer.id,
          volume,
          loadTime: formatMinutes(loadStart),
          // Показываем факт прибытия; заливка может начаться чуть позже (unloadStart).
          arriveTime: formatMinutes(arrive),
          unloadDoneTime: formatMinutes(unloadDone),
          returnTime: formatMinutes(returnAt),
          loadAtMin: loadStart,
          arriveAtMin: arrive,
          returnAtMin: returnAt,
          roadMin,
          loadMin,
          unloadMin,
          locked: false,
          done: false,
        });
        mixerBusy.set(mixer.number, returnAt);
        tripCounts.set(mixer.number, (tripCounts.get(mixer.number) || 0) + 1);
        placedVol = Math.round((placedVol + volume) * 10) / 10;
        left = Math.round((left - volume) * 10) / 10;
        // Следующий рейс — к концу заливки объёма, не к возврату/полному простою.
        const pourMin = Math.max(15, Math.round(volume * POUR_RATE_MIN_PER_M3));
        nextArrive = unloadStart + pourMin + joinBufferMinutes();
        firstTrip = false;
        placed = true;
        break;
      }

      if (!placed) {
        // 1) Добираем хвост в бочки уже поставленных рейсов этой заявки.
        let rem = left;
        for (let i = newTrips.length - 1; i >= 0 && rem > 0.05; i--) {
          const t = newTrips[i];
          if (String(t.orderId) !== String(order.id)) continue;
          const mixer = selectedMixers.find(
            (m) =>
              m.number === t.mixerNumber || String(m.id) === String(t.mixerId),
          );
          const cap = Number(mixer?.volume) || Number(t.volume) || 0;
          const room = Math.round((cap - Number(t.volume)) * 10) / 10;
          if (room <= 0.05) continue;
          const add = Math.min(room, rem);
          t.volume = Math.round((Number(t.volume) + add) * 10) / 10;
          rem = Math.round((rem - add) * 10) / 10;
          placedVol = Math.round((placedVol + add) * 10) / 10;
        }
        if (rem <= 0.05) {
          warnings.push({
            level: 'warn',
            message: `Заявка #${order.id}: хвост закрыт добором в объём предыдущих рейсов.`,
          });
          left = 0;
          break;
        }

        // 2) Последний шанс: рейс «в разрыв» — не ждём стыка заливки, грузим ASAP.
        // Сначала миксеры с меньшим числом рейсов — чтобы выбранный парк не простаивал.
        const gapCandidates = [...selectedMixers].sort((a, b) => {
          const ta = tripCounts.get(a.number) || 0;
          const tb = tripCounts.get(b.number) || 0;
          if (ta !== tb) return ta - tb;
          return (
            selectedMixers.findIndex((m) => m.number === a.number) -
            selectedMixers.findIndex((m) => m.number === b.number)
          );
        });
        for (const mixer of gapCandidates) {
          if (
            !mixerAllowedForPlannerOrder(
              mixer.number,
              { address: order.address, roadMin: baseRoadMin },
              { pickup: false },
            )
          ) {
            continue;
          }
          const volume = Math.min(rem, Number(mixer.volume) || 0);
          if (volume <= 0.05) continue;
          const loadMin = loadMinutesForVolume(volume);
          const unloadMin = unloadMinutesForMixer(mixer);
          const freeFrom = mixerBusy.get(mixer.number) ?? -Infinity;
          let desiredLoad = Math.max(loadFloor, freeFrom === -Infinity ? loadFloor : freeFrom);
          const slot = pushNoOverlap(nozzle, desiredLoad, loadMin);
          const loadStart = slot.start;
          const roadOut = roadWithTraffic(baseRoadMin, loadStart, useTraffic);
          const arrive = loadStart + loadMin + roadOut;
          const unloadStart = arrive; // без ожидания nextArrive
          const unloadDone = unloadStart + unloadMin;
          const roadBack = roadWithTraffic(baseRoadMin, unloadDone, useTraffic);
          const returnAt = unloadDone + roadBack;
          if (!allowNight && returnAt > PLANT_CLOSE_RETURN_MINUTES) {
            const idx = nozzle.findIndex(
              (iv) => iv.start === slot.start && iv.end === slot.end,
            );
            if (idx >= 0) nozzle.splice(idx, 1);
            continue;
          }
          newTrips.push({
            id: allocTripId(order.id, mixer.number),
            orderId: order.id,
            client: order.client,
            mixerNumber: mixer.number,
            mixerId: mixer.id,
            volume,
            loadTime: formatMinutes(loadStart),
            arriveTime: formatMinutes(arrive),
            unloadDoneTime: formatMinutes(unloadDone),
            returnTime: formatMinutes(returnAt),
            loadAtMin: loadStart,
            arriveAtMin: arrive,
            returnAtMin: returnAt,
            roadMin: roadOut,
            loadMin,
            unloadMin,
            locked: false,
            done: false,
          });
          mixerBusy.set(mixer.number, returnAt);
          tripCounts.set(mixer.number, (tripCounts.get(mixer.number) || 0) + 1);
          rem = Math.round((rem - volume) * 10) / 10;
          warnings.push({
            level: 'warn',
            message:
              `Заявка #${order.id}: последний рейс ${mixer.number} (${volume} м³) с паузой между машинами на объекте — ` +
              `так успеваем вернуть миксер до 21:00. Объём заявки закрыт (это не нехватка кубов).`,
          });
          if (rem <= 0.05) break;
        }

        if (rem > 0.05) {
          warnings.push({
            level: 'warn',
            message:
              `Заявка #${order.id}: не удалось закрыть ${rem.toFixed(1)} м³ в окне` +
              (allowNight
                ? '.'
                : ' до 21:00. Включи «Включая ночь» или добери миксеры.'),
          });
          uncoveredOrderIds.add(String(order.id));
          uncoveredVolume += rem;
        }
        left = 0;
        break;
      }
    }

    // Посадка объёмов по вместимости бочек: 6 м³ → 6-куб, хвост → более крупный.
    rebalanceOrderVolumesToMixerCaps(newTrips, order.id, selectedMixers);
  }

  const trips = uniquifyPlannedTripIds([...locked, ...newTrips]).sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );
  uncoveredVolume = Math.round(uncoveredVolume * 10) / 10;
  const fitsWindow = uncoveredOrderIds.size === 0 && uncoveredVolume <= 0.05;

  // После расчёта — факт по рейсам, не эвристика «3 рейса × миксер».
  const actualHint = fleetHintFromPlan(
    trips,
    input.orders.filter((o) => o.status !== 'cancelled' && !doneSet.has(String(o.id))),
    selectedMixers,
    allowNight,
    { uncoveredVolume, useTraffic, plantOpenMinutes: plantOpen },
  );

  return {
    trips,
    newTrips,
    warnings,
    fleetHint: actualHint,
    maxText: formatPlanForMax(
      input.mode === 'stage' ? newTrips : trips,
      warnings,
      actualHint,
      input.mode,
      input.orders,
      { allowNight, useTraffic, plantOpenMinutes: plantOpen },
    ),
    plantOpenMinutes: plantOpen,
    uncoveredOrderIds: [...uncoveredOrderIds],
    uncoveredVolume,
    fitsWindow,
    allowNight,
  };
}

export function formatPlanForMax(
  trips: PlannedTrip[],
  warnings: PlannerWarning[],
  fleetHint: FleetHint,
  mode: PlannerMode = 'full_day',
  /** Если переданы — рейсы группируются под заявками. */
  orders?: PlannerOrder[],
  opts?: {
    allowNight?: boolean;
    useTraffic?: boolean;
    orderShifts?: PlannerOrderShift[];
    plantOpenMinutes?: number;
  },
): string {
  const title =
    mode === 'stage'
      ? 'ЭТАП ПЛАНА ОТГРУЗКИ (интеллект)'
      : 'ПЛАН ОТГРУЗКИ НА ДЕНЬ (интеллект)';
  let text = `${title}\n`;
  const plantOpen =
    opts?.plantOpenMinutes ??
    resolvePlantOpenMinutes(orders || [], { useTraffic: opts?.useTraffic });
  if (opts?.allowNight) text += 'Режим: включая ночь\n';
  else text += `Режим: ${formatPlantWindowLabel(plantOpen, false)}\n`;
  if (opts?.useTraffic) text += 'Пробки: учёт по часу суток\n';
  text += `${fleetHint.text}\n`;
  if (opts?.orderShifts?.length) {
    text += 'Сдвиги целей:\n';
    for (const s of opts.orderShifts) {
      const sign = s.deltaMin >= 0 ? '+' : '';
      text += `• #${s.orderId}: ${s.from} → ${s.to} (${sign}${s.deltaMin} мин)\n`;
    }
  }
  text += `\n`;

  if (!trips.length) {
    text += 'Рейсов в этом блоке нет.\n';
  } else if (orders?.length) {
    const byOrder = new Map<string, PlannedTrip[]>();
    for (const t of trips) {
      const key = String(t.orderId);
      const list = byOrder.get(key) || [];
      list.push(t);
      byOrder.set(key, list);
    }
    const ordered = [...orders]
      .filter((o) => byOrder.has(String(o.id)))
      .sort(
        (a, b) =>
          (parseHhMm(a.deliveryTime) ?? 0) - (parseHhMm(b.deliveryTime) ?? 0),
      );
    const seen = new Set(ordered.map((o) => String(o.id)));
    // Рейсы по заявкам вне списка (на всякий случай) — в конце.
    const orphans = trips.filter((t) => !seen.has(String(t.orderId)));
    let n = 0;
    for (const o of ordered) {
      const list = (byOrder.get(String(o.id)) || []).sort(
        (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
      );
      const vol = list.reduce((s, t) => s + (Number(t.volume) || 0), 0);
      text += `#${o.id} ${o.client} · ${Number(vol.toFixed(1))} м³ · к ${formatTimeHHMM(o.deliveryTime) || o.deliveryTime}\n`;
      for (const t of list) {
        n += 1;
        if (t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER) {
          text += `  ${n}) самовывоз · ${t.volume} м³ · загрузка ${t.loadTime} · соска будет готова ~${t.arriveTime}\n`;
        } else {
          // Уже с пометкой (+1д) при уходе за полночь — не режем через formatTimeHHMM.
          text += `  ${n}) ${t.mixerNumber} · ${t.volume} м³ · загрузка ${t.loadTime} · на объекте ${t.arriveTime} · обратно ~${t.returnTime}\n`;
        }
      }
      text += '\n';
    }
    if (orphans.length) {
      text += 'Прочие рейсы:\n';
      for (const t of orphans) {
        n += 1;
        text += `  ${n}) ${t.mixerNumber} → #${t.orderId} ${t.client} · ${t.volume} м³ · загрузка ${formatTimeHHMM(t.loadTime) || t.loadTime}\n`;
      }
      text += '\n';
    }
  } else {
    trips.forEach((t, i) => {
      if (t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER) {
        text += `${i + 1}) самовывоз → #${t.orderId} ${t.client}\n`;
        text += `   ${t.volume} м³ • загрузка ${formatTimeHHMM(t.loadTime) || t.loadTime} • соска будет готова ~${formatTimeHHMM(t.arriveTime) || t.arriveTime}\n`;
      } else {
        text += `${i + 1}) ${t.mixerNumber} → #${t.orderId} ${t.client}\n`;
        text += `   ${t.volume} м³ • загрузка ${formatTimeHHMM(t.loadTime) || t.loadTime} • на объекте ${formatTimeHHMM(t.arriveTime) || t.arriveTime}\n`;
        text += `   обратно ~${formatTimeHHMM(t.returnTime) || t.returnTime} (дорога ${t.roadMin} мин, разгрузка ${t.unloadMin} мин)\n`;
      }
    });
  }

  if (warnings.length) {
    // Все замечания целиком — логисту нужно видеть каждый сдвиг, без «…и ещё N».
    text += `\n⚠ Замечания планировщика (${warnings.length}):\n`;
    for (const w of warnings) {
      text += `• ${w.message}\n`;
    }
  }

  return text.trim() + '\n';
}

function scenarioFromResult(
  id: PlannerScenarioId,
  title: string,
  summary: string,
  mixers: PlannerMixer[],
  result: PlanLogisticsResult,
  orderShifts: PlannerOrderShift[],
  nightHint?: string,
): PlannerScenario {
  const usedMixers = mixersUsedInResult(mixers, result);
  const effectiveMixers =
    result.fitsWindow && usedMixers.length > 0 ? usedMixers : mixers;
  const rentedCount = effectiveMixers.filter((m) => m.type === 'rented').length;
  const maxShiftMin = orderShifts.reduce(
    (m, s) => Math.max(m, Math.abs(s.deltaMin)),
    0,
  );
  const mixerCount = new Set(
    result.trips
      .filter((t) => !t.pickup && t.mixerNumber !== PICKUP_MIXER_NUMBER)
      .map((t) => t.mixerNumber),
  ).size;
  return {
    id,
    title,
    summary,
    mixerIds: effectiveMixers.map((m) => String(m.id)),
    mixers: effectiveMixers,
    trips: result.trips,
    warnings: result.warnings,
    fleetHint: result.fleetHint,
    uncoveredOrderIds: result.uncoveredOrderIds,
    uncoveredVolume: result.uncoveredVolume,
    tripCount: result.trips.length,
    mixerCount,
    rentedCount,
    maxShiftMin,
    orderShifts,
    allowNight: result.allowNight,
    fitsWindow: result.fitsWindow,
    nightHint,
  };
}

/** Миксеры, реально занятые в рейсах (+ locked). */
function mixersUsedInResult(
  pool: PlannerMixer[],
  result: PlanLogisticsResult,
  lockedTrips?: PlannedTrip[],
): PlannerMixer[] {
  const byId = new Map(pool.map((m) => [String(m.id), m]));
  const byNumber = new Map(pool.map((m) => [m.number, m]));
  const out: PlannerMixer[] = [];
  const seen = new Set<string>();
  const consider = (id: string | number | undefined, number: string, pickup?: boolean) => {
    if (pickup || number === PICKUP_MIXER_NUMBER) return;
    const m = (id != null && byId.get(String(id))) || byNumber.get(number);
    if (!m || seen.has(String(m.id))) return;
    seen.add(String(m.id));
    out.push(m);
  };
  for (const t of result.trips) consider(t.mixerId, t.mixerNumber, t.pickup);
  for (const t of lockedTrips || []) consider(t.mixerId, t.mixerNumber, t.pickup);
  return out;
}

/** «5 своих + 5 наёмных» */
export function formatOwnRented(ownCount: number, rentedCount: number): string {
  const bits: string[] = [];
  if (ownCount > 0) {
    bits.push(
      `${ownCount} ${pluralRu(ownCount, 'свой', 'своих', 'своих')}`,
    );
  }
  if (rentedCount > 0) {
    bits.push(
      `${rentedCount} ${pluralRu(rentedCount, 'наёмный', 'наёмных', 'наёмных')}`,
    );
  }
  if (!bits.length) return '0 миксеров';
  return bits.join(' + ');
}

function countOwnRented(mixers: PlannerMixer[]): {
  ownCount: number;
  rentedCount: number;
} {
  let ownCount = 0;
  let rentedCount = 0;
  for (const m of mixers) {
    if (m.type === 'rented') rentedCount += 1;
    else ownCount += 1;
  }
  return { ownCount, rentedCount };
}

/**
 * Текст для диспетчера: сколько миксеров нужно, а не «парк раздут до 23».
 */
export function formatFleetGrowAdvice(opts: {
  initialCount: number;
  neededCount: number;
  added: PlannerMixer[];
  fits: boolean;
  uncoveredVolume?: number;
  ownCount?: number;
  rentedCount?: number;
  /** Сколько реально занято в рейсах (может быть меньше выбора диспетчера). */
  usedCount?: number;
}): string {
  const {
    initialCount,
    neededCount,
    added,
    fits,
    uncoveredVolume,
    ownCount,
    rentedCount,
    usedCount,
  } = opts;
  const comp =
    ownCount != null && rentedCount != null && (usedCount ?? neededCount) > 0
      ? ` (${formatOwnRented(ownCount, rentedCount)})`
      : '';
  if (!fits) {
    const tail =
      uncoveredVolume != null && uncoveredVolume > 0.05
        ? ` — хвост ${uncoveredVolume.toFixed(1)} м³`
        : '';
    return (
      `Даже со всем доступным парком не влезает в окно${tail}. ` +
      `Включи «Включая ночь» или сдвинь время (вариант B).`
    );
  }
  if (neededCount <= 0) return '';

  const used = usedCount ?? neededCount;
  // Диспетчер выбрал больше машин, чем получилось задействовать в рейсах.
  if (added.length === 0 && initialCount > used) {
    const idle = initialCount - used;
    return (
      `В плане участвуют ${used} из ${initialCount} выбранных${comp}` +
      ` — на ${idle} ${pluralRu(idle, 'миксер', 'миксера', 'миксеров')} рейсов не осталось ` +
      `(объём дня закрыт меньшим парком).`
    );
  }
  if (neededCount <= initialCount && added.length === 0) {
    return (
      `Текущего выбора хватает: все ${used} ` +
      `${pluralRu(used, 'миксер', 'миксера', 'миксеров')} в рейсах${comp}.`
    );
  }
  const extra = Math.max(0, neededCount - initialCount);
  const names = added.map((m) => m.number).filter(Boolean);
  const namePart = names.length ? `: ${names.join(', ')}` : '';
  if (extra <= 0) {
    return `В плане ${neededCount} ${pluralRu(neededCount, 'миксер', 'миксера', 'миксеров')}${comp}.`;
  }
  if (extra === 1) {
    return `Увеличь парк до ${neededCount}${comp}, чтобы уложиться в окно (+1 миксер${namePart}).`;
  }
  const extraWord = pluralRu(extra, 'миксер', 'миксера', 'миксеров');
  return `Увеличь парк до ${neededCount}${comp}, чтобы уложиться в окно (+${extra} ${extraWord}${namePart}).`;
}

/**
 * Оценка при открытии дня: сколько своих/наёмных нужно под объём и окно.
 * Стартует со своих, плавно добирает — тот же движок, что «Рассчитать».
 */
export function estimateDayFleetNeed(
  orders: PlannerOrder[],
  allMixers: PlannerMixer[],
  opts?: { allowNight?: boolean; useTraffic?: boolean },
): {
  neededCount: number;
  ownCount: number;
  rentedCount: number;
  totalVolume: number;
  fits: boolean;
  uncoveredVolume: number;
  mixers: PlannerMixer[];
  text: string;
} {
  const active = orders.filter((o) => o.status !== 'cancelled');
  const totalVolume =
    Math.round(active.reduce((s, o) => s + (Number(o.volume) || 0), 0) * 10) / 10;
  const ranked = rankFleetForDay(allMixers.filter((m) => Number(m.volume) > 0));
  if (!active.length || totalVolume <= 0) {
    return {
      neededCount: 0,
      ownCount: 0,
      rentedCount: 0,
      totalVolume,
      fits: true,
      uncoveredVolume: 0,
      mixers: [],
      text: 'На день нет объёма для планирования.',
    };
  }
  if (!ranked.length) {
    return {
      neededCount: 0,
      ownCount: 0,
      rentedCount: 0,
      totalVolume,
      fits: false,
      uncoveredVolume: totalVolume,
      mixers: [],
      text: `Объём ${totalVolume} м³ — в справочнике нет миксеров с бочкой.`,
    };
  }

  const ownSeed = ranked.filter((m) => m.type === 'own');
  const seed = ownSeed.length > 0 ? ownSeed : ranked.slice(0, 1);
  const grown = ensureFleetForWindow(
    {
      mode: 'full_day',
      orders: active,
      mixers: seed,
      allowNight: opts?.allowNight,
      useTraffic: opts?.useTraffic,
    },
    ranked,
  );

  const used = mixersUsedInResult(grown.mixers, grown.result);
  const mixers = used.length > 0 ? used : grown.mixers;
  const { ownCount, rentedCount } = countOwnRented(mixers);
  const neededCount = mixers.length;
  const plantOpen =
    grown.result.plantOpenMinutes ??
    resolvePlantOpenMinutes(active, {
      useTraffic: opts?.useTraffic,
    });
  const windowPart = formatPlantWindowLabel(plantOpen, Boolean(opts?.allowNight));

  let text: string;
  if (grown.result.fitsWindow && neededCount > 0) {
    text =
      `По объёму дня (${totalVolume} м³) нужно ${neededCount} ` +
      `${pluralRu(neededCount, 'миксер', 'миксера', 'миксеров')}: ` +
      `${formatOwnRented(ownCount, rentedCount)} — ${windowPart}.`;
  } else {
    text =
      `По объёму дня (${totalVolume} м³) полным парком не закрыть` +
      (grown.result.uncoveredVolume > 0.05
        ? ` — хвост ~${grown.result.uncoveredVolume.toFixed(1)} м³`
        : '') +
      `. Попробуй «Включая ночь» или сдвиги времени.`;
  }

  return {
    neededCount,
    ownCount,
    rentedCount,
    totalVolume,
    fits: grown.result.fitsWindow,
    uncoveredVolume: grown.result.uncoveredVolume,
    mixers,
    text,
  };
}

/**
 * Плавно добирает миксеры по одному (ранг), пока день не влезет.
 * После успеха оставляет только занятых в плане — без «выбрать всех 23».
 */
export function ensureFleetForWindow(
  input: PlanLogisticsInput,
  allMixers: PlannerMixer[],
): {
  mixers: PlannerMixer[];
  added: PlannerMixer[];
  initialCount: number;
  neededCount: number;
  result: PlanLogisticsResult;
  advice: string;
} {
  const allowNight = Boolean(input.allowNight);
  const ranked = rankFleetForDay(allMixers);
  const initialIds = new Set(input.mixers.map((m) => String(m.id)));
  const selectedIds = new Set(initialIds);
  let mixers = [...input.mixers];
  const added: PlannerMixer[] = [];
  const initialCount = mixers.length;

  let result = planLogistics({ ...input, mixers, allowNight });
  if (!result.fitsWindow) {
    for (const m of ranked) {
      if (selectedIds.has(String(m.id))) continue;
      mixers = [...mixers, m];
      selectedIds.add(String(m.id));
      added.push(m);
      result = planLogistics({ ...input, mixers, allowNight });
      if (result.fitsWindow) break;
    }
  }

  // Если мы добирали сверх выбора диспетчера — оставляем исходных + нужные добавки.
  // Если диспетчер сам дал запас (8 вместо 7) — НЕ сжимаем план обратно:
  // времена уже посчитаны на полном выборе, лишние машины дают параллель.
  let finalAdded: PlannerMixer[] = [];
  const countDeliveryMixers = (trips: PlannedTrip[]) =>
    new Set(
      trips
        .filter((t) => !t.pickup && t.mixerNumber !== PICKUP_MIXER_NUMBER)
        .map((t) => t.mixerNumber),
    ).size;
  let usedCount = countDeliveryMixers(result.trips);
  const weGrewFleet = added.length > 0;

  if (result.fitsWindow && result.trips.length > 0 && weGrewFleet) {
    const usedOnly = mixersUsedInResult(mixers, result, input.lockedTrips);
    if (usedOnly.length > 0) {
      const extrasUsed = usedOnly.filter((m) => !initialIds.has(String(m.id)));
      const minimalPool = [...input.mixers];
      for (const m of extrasUsed) {
        if (!initialIds.has(String(m.id))) minimalPool.push(m);
      }
      const trimmed = planLogistics({
        ...input,
        mixers: minimalPool,
        allowNight,
      });
      if (trimmed.fitsWindow) {
        result = trimmed;
        usedCount = countDeliveryMixers(trimmed.trips);
        finalAdded = extrasUsed;
        mixers = minimalPool;
      } else {
        finalAdded = [...added];
      }
    }
  } else if (result.fitsWindow) {
    // Диспетчерский парк уже закрыл день — оставляем его целиком.
    finalAdded = [];
    mixers = [...input.mixers];
  } else {
    finalAdded = [...added];
    usedCount = Math.max(usedCount, mixers.length);
  }

  const targetCount =
    finalAdded.length > 0
      ? Math.max(usedCount, initialCount + finalAdded.length)
      : Math.max(usedCount, initialCount);

  const usedForComp = mixersUsedInResult(mixers, result, input.lockedTrips);
  const { ownCount, rentedCount } = countOwnRented(
    usedForComp.length > 0 ? usedForComp : mixers,
  );

  const advice = formatFleetGrowAdvice({
    initialCount,
    neededCount: targetCount,
    added: finalAdded,
    fits: result.fitsWindow,
    uncoveredVolume: result.uncoveredVolume,
    ownCount,
    rentedCount,
    usedCount,
  });

  return {
    mixers,
    added: finalAdded,
    initialCount,
    neededCount: targetCount,
    result,
    advice,
  };
}

/** Подбор сдвига цели в ±MAX_ARRIVE_SHIFT_MINUTES, чтобы заявка влезла в окно. */
function findBestArriveOverride(
  input: PlanLogisticsInput,
  orderId: string,
): { arriveLabel: string; deltaMin: number } | null {
  const order = input.orders.find((o) => String(o.id) === orderId);
  if (!order) return null;
  const target = parseHhMm(order.deliveryTime);
  if (target == null) return null;

  for (let d = 0; d <= MAX_ARRIVE_SHIFT_MINUTES; d += 15) {
    const candidates =
      d === 0
        ? [target]
        : [target + d, target - d].filter((t) => t >= PLANT_OPEN_EARLIEST_MINUTES);
    for (const arriveAt of candidates) {
      const arriveLabel = formatMinutes(arriveAt);
      const overrides = {
        ...(input.arriveOverrides || {}),
        [orderId]: arriveLabel,
      };
      const r = planLogistics({
        ...input,
        arriveOverrides: overrides,
        allowNight: Boolean(input.allowNight),
      });
      if (!r.uncoveredOrderIds.includes(orderId)) {
        return { arriveLabel, deltaMin: arriveAt - target };
      }
    }
  }
  return null;
}

/**
 * Варианты A/B/C при нехватке. Ночь не включается молча — только флаг allowNight из UI.
 */
export function buildPlannerScenarios(
  input: PlanLogisticsInput,
  allMixers: PlannerMixer[],
): PlannerScenario[] {
  const allowNight = Boolean(input.allowNight);
  const baseInput = { ...input, allowNight };
  const scenarios: PlannerScenario[] = [];

  // A — жёсткие времена, плавный добор миксеров
  const fleetA = ensureFleetForWindow(baseInput, allMixers);
  scenarios.push(
    scenarioFromResult(
      'A',
      'Жёсткие времена',
      fleetA.advice ||
        (allowNight
          ? 'Добор миксеров без сдвига целей.'
          : 'Добор миксеров, цели без сдвига, возврат ≤ 21:00.'),
      fleetA.mixers,
      {
        ...fleetA.result,
        maxText: formatPlanForMax(
          fleetA.result.trips,
          fleetA.result.warnings,
          fleetA.result.fleetHint,
          baseInput.mode,
          baseInput.orders,
          { allowNight, useTraffic: Boolean(baseInput.useTraffic) },
        ),
      },
      [],
      !allowNight && !fleetA.result.fitsWindow
        ? 'Не влезает до 21:00 — поставь «Включая ночь» или сдвинь время (вариант B).'
        : undefined,
    ),
  );

  // B — сдвиги ±60, затем добор при необходимости
  let overridesB: Record<string, string> = { ...(baseInput.arriveOverrides || {}) };
  const shiftsB: PlannerOrderShift[] = [];
  let mixersB = [...baseInput.mixers];
  let resultB = planLogistics({
    ...baseInput,
    mixers: mixersB,
    arriveOverrides: overridesB,
  });

  for (const oid of [...resultB.uncoveredOrderIds]) {
    const found = findBestArriveOverride(
      { ...baseInput, mixers: mixersB, arriveOverrides: overridesB },
      oid,
    );
    if (!found) continue;
    overridesB = { ...overridesB, [oid]: found.arriveLabel };
    const order = baseInput.orders.find((o) => String(o.id) === oid);
    if (order && found.deltaMin !== 0) {
      shiftsB.push({
        orderId: oid,
        from: formatTimeHHMM(order.deliveryTime) || String(order.deliveryTime),
        to: found.arriveLabel,
        deltaMin: found.deltaMin,
      });
    }
    resultB = planLogistics({
      ...baseInput,
      mixers: mixersB,
      arriveOverrides: overridesB,
    });
  }

  const fleetB = ensureFleetForWindow(
    { ...baseInput, mixers: mixersB, arriveOverrides: overridesB },
    allMixers,
  );
  mixersB = fleetB.mixers;
  resultB = {
    ...fleetB.result,
    maxText: formatPlanForMax(
      fleetB.result.trips,
      fleetB.result.warnings,
      fleetB.result.fleetHint,
      baseInput.mode,
      baseInput.orders,
      {
        allowNight,
        useTraffic: Boolean(baseInput.useTraffic),
        orderShifts: shiftsB,
      },
    ),
  };

  const summaryBParts = [
    shiftsB.length
      ? `Сдвиги целей: ${shiftsB.length}`
      : allowNight
        ? 'Гибкое время клиента'
        : 'Сдвиги до ±60 мин, возврат ≤ 21:00',
  ];
  if (fleetB.added.length || fleetB.neededCount > fleetB.initialCount) {
    summaryBParts.push(fleetB.advice);
  }
  scenarios.push(
    scenarioFromResult(
      'B',
      'Сдвиги до ±60 мин',
      summaryBParts.filter(Boolean).join('. ') + '.',
      mixersB,
      resultB,
      shiftsB,
      !allowNight && !resultB.fitsWindow
        ? 'Даже со сдвигами не влезает до 21:00 — поставь «Включая ночь».'
        : undefined,
    ),
  );

  // C — текущий парк без добора
  const resultC = planLogistics(baseInput);
  const nightHint =
    !allowNight && !resultC.fitsWindow
      ? 'Не влезает до 21:00 — поставь «Включая ночь» или добери миксеры / сдвинь время.'
      : undefined;
  scenarios.push(
    scenarioFromResult(
      'C',
      'Текущий парк',
      resultC.fitsWindow
        ? 'Текущий парк закрывает объём.'
        : `Что влезает — в плане; хвост ${resultC.uncoveredVolume.toFixed(1)} м³.`,
      baseInput.mixers,
      resultC,
      [],
      nightHint,
    ),
  );

  return scenarios;
}

/**
 * Статусы рейса, которые считаем уже отгруженными с БСУ (факт оператора).
 * Для самовывоза после «Загружен» обычно «В пути» — без «Разгружен».
 */
export const PLANNER_FACT_SHIPPED_STATUSES = [
  'В пути',
  'На объекте',
  'Разгружен',
  'Возврат',
] as const;

export type LiveTripFact = {
  orderId?: unknown;
  order_id?: unknown;
  status?: string | null;
  volume?: number | string | null;
  loading_started_at?: string | null;
  loadingStartedAt?: string | null;
};

/** Объём, уже ушедший с соски по live order_mixers (включая начатую загрузку). */
export function liveShippedVolumeForOrder(
  orderId: string | number,
  trips: LiveTripFact[],
): number {
  const oid = String(orderId);
  let sum = 0;
  for (const t of trips) {
    if (String(t.orderId ?? t.order_id) !== oid) continue;
    const status = String(t.status || '');
    const started = Boolean(t.loading_started_at || t.loadingStartedAt);
    if (
      (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(status) ||
      (status === 'Загрузка' && started)
    ) {
      sum += Number(t.volume) || 0;
    }
  }
  return Math.round(sum * 10) / 10;
}

/**
 * Объём, уже занятый назначениями в заявке (в т.ч. ручные «Загрузка» диспетчера
 * без старта на пульте). Нужен, чтобы интеллект не планировал поверх ручной работы.
 */
export function liveAssignedVolumeForOrder(
  orderId: string | number,
  trips: LiveTripFact[],
): number {
  const oid = String(orderId);
  let sum = 0;
  for (const t of trips) {
    if (String(t.orderId ?? t.order_id) !== oid) continue;
    const status = String(t.status || '');
    if (
      status === 'Загрузка' ||
      (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(status) ||
      status === 'Проблема'
    ) {
      sum += Number(t.volume) || 0;
    }
  }
  return Math.round(sum * 10) / 10;
}

function formatHhMmFromMinutes(total: number): string {
  const DAY = 24 * 60;
  let inDay = ((total % DAY) + DAY) % DAY;
  const h = Math.floor(inDay / 60);
  const m = Math.floor(inDay % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Заявки с остатком объёма по факту + ручным назначениям диспетчера.
 * Вычитаем уже занятый объём (Загрузка / в пути / …), чтобы расчёт не дублировал
 * ручные миксеры. Если по заявке уже что-то ушло/назначено — цель стыка не раньше «сейчас».
 */
export function applyLiveFactToOrders(
  orders: PlannerOrder[],
  dayTrips: LiveTripFact[],
  opts?: { nowMinutes?: number | null },
): { orders: PlannerOrder[]; shippedTotal: number; fullyShippedCount: number } {
  const nowMin = opts?.nowMinutes;
  const out: PlannerOrder[] = [];
  let shippedTotal = 0;
  let fullyShippedCount = 0;

  for (const o of orders) {
    const st = String(o.status || '').toLowerCase();
    if (st === 'cancelled') continue;
    if (st === 'completed') {
      fullyShippedCount += 1;
      shippedTotal += liveAssignedVolumeForOrder(o.id, dayTrips);
      continue;
    }
    const planVol = Number(o.volume) || 0;
    const assigned = liveAssignedVolumeForOrder(o.id, dayTrips);
    const shipped = liveShippedVolumeForOrder(o.id, dayTrips);
    shippedTotal += assigned;
    const rem = Math.round((planVol - assigned) * 10) / 10;
    if (rem <= 0.05) {
      if (planVol > 0.05 || assigned > 0.05) fullyShippedCount += 1;
      continue;
    }

    let deliveryTime = o.deliveryTime;
    // Сдвиг «от сейчас» — только если уже есть факт/старт, не из‑за черновых «Загрузка».
    if (shipped > 0.05 && nowMin != null && Number.isFinite(nowMin)) {
      const goal = parseHhMm(o.deliveryTime);
      const effective = Math.max(goal ?? nowMin, nowMin);
      deliveryTime = formatHhMmFromMinutes(effective);
    }

    out.push({ ...o, volume: rem, deliveryTime });
  }

  return {
    orders: out,
    shippedTotal: Math.round(shippedTotal * 10) / 10,
    fullyShippedCount,
  };
}

/** Минуты от полуночи «сейчас», если dateKey (YYYY-M-D / YYYY-MM-DD) — сегодня. */
export function nowMinutesIfDateKeyIsToday(dateKey: string): number | null {
  const parts = String(dateKey || '').split('-').map((x) => parseInt(x, 10));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const now = new Date();
  if (now.getFullYear() !== y || now.getMonth() + 1 !== m || now.getDate() !== d) {
    return null;
  }
  return now.getHours() * 60 + now.getMinutes();
}

/** Статус заявки для бейджа в UI. */
export function orderProgressStatus(
  order: PlannerOrder,
  assignedTrips: LiveTripFact[],
  plannedTrips: PlannedTrip[],
  manualDone: boolean,
): 'done' | 'in_work' | 'planned' {
  if (manualDone || order.status === 'completed') return 'done';
  const oid = String(order.id);
  const planVol = Number(order.volume) || 0;
  const shipped = liveShippedVolumeForOrder(oid, assignedTrips);
  const live = assignedTrips.filter(
    (t) => String(t.orderId ?? t.order_id) === oid,
  );
  const active = live.some((t) =>
    ['Загрузка', 'В пути', 'На объекте', 'Проблема'].includes(String(t.status || '')),
  );

  // Сначала live-активность: «В пути» на доставке ≠ отработана, даже если кубы
  // уже ушли с БСУ (раньше volume-check ставил done и прятал рейс из плана).
  // Самовывоз: после загрузки часто остаётся «В пути» без «Разгружен» — тогда
  // закрываем по объёму.
  if (active) {
    if (
      isPickupOrder(order.address) &&
      planVol > 0 &&
      shipped >= planVol - 0.05
    ) {
      return 'done';
    }
    return 'in_work';
  }

  if (planVol > 0 && shipped >= planVol - 0.05) return 'done';
  if (shipped > 0.05) return 'in_work';

  const plannedDone = plannedTrips.some((t) => String(t.orderId) === oid && t.done);
  if (plannedDone) return 'done';
  return 'planned';
}

/**
 * Live order_mixers, которых нет среди слотов плана (диспетчер завёл вручную).
 * Показываем в UI как read-only строки «из заявки».
 * ETA объекта/возврата считаем по той же схеме, что и план (погрузка + дорога + разгрузка),
 * иначе в строке были бы «объект — / обр. —» при живом «В пути».
 */
export function orphanLiveTripsAsPlanned(
  order: PlannerOrder,
  dayTrips: Array<
    LiveTripFact & {
      id?: number | string;
      number?: string | null;
      mixer_name?: string | null;
      time?: string | null;
    }
  >,
  plannedForOrder: PlannedTrip[],
): PlannedTrip[] {
  const linked = new Set<string>();
  for (const t of plannedForOrder) {
    if (t.orderMixerId != null) linked.add(String(t.orderMixerId));
  }
  const oid = String(order.id);
  const out: PlannedTrip[] = [];
  const pickup = isPickupOrder(order.address);
  const baseRoad = Math.max(5, Number(order.roadMin) || 30);

  for (const d of dayTrips) {
    if (String(d.orderId ?? d.order_id) !== oid) continue;
    if (d.id == null) continue;
    const id = String(d.id);
    if (linked.has(id)) continue;
    const st = String(d.status || '');
    const mixer = String(d.number || d.mixer_name || '—').trim() || '—';
    const timeRaw = String(d.time || '').trim();
    const loadHhMm = timeRaw.slice(0, 5) || '—';
    const loadAt = parseHhMm(loadHhMm);
    const vol = Math.round((Number(d.volume) || 0) * 10) / 10;
    const tripVol = vol > 0 ? vol : 0.1;
    const loadMin = loadMinutesForVolume(tripVol);
    const unloadMin = pickup
      ? 0
      : unloadMinutesForMixer({
          id: `live-${id}`,
          number: mixer,
          volume: tripVol,
          type: 'own',
        });

    let arriveTime = '—';
    let unloadDoneTime = '—';
    let returnTime = '—';
    let arriveAtMin: number | undefined;
    let returnAtMin: number | undefined;

    if (loadAt != null) {
      if (pickup) {
        const readyAt = loadAt + loadMin;
        arriveTime = formatMinutes(readyAt);
        arriveAtMin = readyAt;
      } else {
        const roadOut = roadWithTraffic(baseRoad, loadAt, false);
        const arrive = loadAt + loadMin + roadOut;
        const unloadDone = arrive + unloadMin;
        const roadBack = roadWithTraffic(baseRoad, unloadDone, false);
        const returnAt = unloadDone + roadBack;
        arriveTime = formatMinutes(arrive);
        unloadDoneTime = formatMinutes(unloadDone);
        returnTime = formatMinutes(returnAt);
        arriveAtMin = arrive;
        returnAtMin = returnAt;
      }
    }

    out.push({
      id: `live-orphan-${id}`,
      orderId: order.id,
      client: order.client,
      mixerNumber: mixer,
      mixerId: `live-${id}`,
      volume: tripVol,
      loadTime: loadHhMm,
      arriveTime,
      unloadDoneTime,
      returnTime,
      loadAtMin: loadAt ?? undefined,
      arriveAtMin,
      returnAtMin,
      roadMin: baseRoad,
      loadMin,
      unloadMin,
      locked: true,
      done: st === 'Разгружен' || st === 'Возврат',
      orderMixerId: Number.isFinite(Number(d.id)) ? Number(d.id) : null,
      pickup: pickup || undefined,
    });
  }
  return out;
}

// ——— Фаза 4: волны, сдвиг рейса, агрегат опоздания ———

/** Парсинг «HH:MM» / «HH:MM (+Nd)» → минуты от полуночи дня плана. */
export function parsePlanHhMm(t: string): number | null {
  return parseHhMm(t);
}

/** Минуты → подпись плана. */
export function formatPlanMinutes(total: number): string {
  return formatMinutes(total);
}

/** Медиана положительных опозданий (>5 мин); 0 если нет. */
export function medianFactDelayMin(
  deltas: Array<number | null | undefined>,
): number {
  const pos = deltas
    .filter((d): d is number => d != null && Number.isFinite(d) && d > 5)
    .sort((a, b) => a - b);
  if (pos.length === 0) return 0;
  return Math.round(pos[Math.floor(pos.length / 2)]);
}

export function makePlannerWave(opts: {
  index: number;
  mode: PlannerWave['mode'];
  trips: PlannedTrip[];
  newTripIds?: string[];
  delayFactMin?: number;
  createdByName?: string | null;
  summary?: string;
  calibrationSource?: PlannerWave['calibrationSource'];
}): PlannerWave {
  // «План дня» — первый полный расчёт (не время суток). В скобках в отчёте
  // потом пишется createdAt (когда посчитали), напр. «План дня (22:43)».
  const label =
    opts.mode === 'full_day' || opts.index === 0
      ? 'План дня'
      : opts.mode === 'shift'
        ? 'Сдвиг рейса'
        : `Этап ${opts.index}`;
  const tripIds = opts.trips.map((t) => t.id);
  const newIds = opts.newTripIds || tripIds;
  return {
    id: `wave-${opts.index}-${opts.mode}-${Date.now()}`,
    index: opts.index,
    label,
    mode: opts.mode,
    createdAt: new Date().toISOString(),
    createdByName: opts.createdByName || null,
    tripCount: opts.trips.length,
    newTripCount: newIds.length,
    delayFactMin: opts.delayFactMin || undefined,
    tripIds: newIds,
    summary: opts.summary,
    calibrationSource: opts.calibrationSource,
  };
}

/** Подпись волны для UI/отчёта (старые планы могли хранить «Утро»). */
export function formatPlannerWaveLabel(label: string | null | undefined): string {
  const t = String(label || '').trim();
  if (!t || t === 'Утро') return 'План дня';
  return t;
}

export function nextWaveStageIndex(waves: PlannerWave[]): number {
  const stageLike = waves.filter((w) => w.mode === 'full_day' || w.mode === 'stage');
  if (stageLike.length === 0) return 0;
  return Math.max(...stageLike.map((w) => w.index)) + 1;
}

/** Пересчитать времена одного рейса при новом старте загрузки. */
export function applyManualLoadShiftToTrip(
  trip: PlannedTrip,
  newLoadAtMin: number,
): PlannedTrip {
  const loadMin = Math.max(1, Number(trip.loadMin) || 15);
  const delay = Math.max(0, Math.round(Number(trip.delayMin) || 0));
  const unloadMin = Math.max(0, Number(trip.unloadMin) || PLANNER_UNLOAD_MIN);
  const road = Math.max(0, Number(trip.roadMin) || 0);
  const isPu = Boolean(trip.pickup || trip.mixerNumber === PICKUP_MIXER_NUMBER);
  if (isPu) {
    const ready = newLoadAtMin + loadMin;
    return {
      ...trip,
      loadAtMin: newLoadAtMin,
      loadTime: formatMinutes(newLoadAtMin),
      arriveAtMin: ready,
      arriveTime: formatMinutes(ready),
      unloadDoneTime: formatMinutes(ready),
      returnAtMin: ready,
      returnTime: '—',
      locked: true,
    };
  }
  const arrive = newLoadAtMin + loadMin + road;
  const unloadDone = arrive + unloadMin;
  const returnAt = unloadDone + road;
  return {
    ...trip,
    loadAtMin: newLoadAtMin,
    loadTime: formatMinutes(newLoadAtMin),
    arriveAtMin: arrive,
    arriveTime: formatMinutes(arrive),
    unloadDoneTime: formatMinutes(unloadDone),
    returnAtMin: returnAt,
    returnTime: formatMinutes(returnAt),
    delayMin: delay || undefined,
    locked: true,
  };
}

/**
 * Задержка диспетчера на рейсе (мин): удлиняет разгрузку и возврат миксера.
 * load/arrive не трогаем — опоздание уже на объекте.
 */
export function applyTripDelayMinutes(
  trip: PlannedTrip,
  delayMin: number,
): PlannedTrip {
  const delay = Math.max(0, Math.round(Number(delayMin) || 0));
  const prevDelay = Math.max(0, Math.round(Number(trip.delayMin) || 0));
  const currentUnload = Math.max(0, Number(trip.unloadMin) || PLANNER_UNLOAD_MIN);
  const baseUnload = Math.max(PLANNER_UNLOAD_MIN, currentUnload - prevDelay);
  const newUnload = baseUnload + delay;
  const isPu = Boolean(trip.pickup || trip.mixerNumber === PICKUP_MIXER_NUMBER);
  if (isPu) {
    return {
      ...trip,
      delayMin: delay || undefined,
      unloadMin: newUnload,
      locked: true,
    };
  }
  const loadAt = trip.loadAtMin ?? parseHhMm(trip.loadTime) ?? 0;
  const loadMin = Math.max(1, Number(trip.loadMin) || 15);
  const road = Math.max(0, Number(trip.roadMin) || 0);
  const arrive =
    trip.arriveAtMin ??
    parseHhMm(trip.arriveTime) ??
    loadAt + loadMin + road;
  const unloadDone = arrive + newUnload;
  const returnAt = unloadDone + road;
  return {
    ...trip,
    delayMin: delay || undefined,
    unloadMin: newUnload,
    arriveAtMin: arrive,
    arriveTime: formatMinutes(arrive),
    unloadDoneTime: formatMinutes(unloadDone),
    returnAtMin: returnAt,
    returnTime: formatMinutes(returnAt),
    locked: true,
  };
}

type ReplanTailInput = {
  allTrips: PlannedTrip[];
  tripId: string;
  mutate: (trip: PlannedTrip) => PlannedTrip;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
};

function replanTailAfterTripMutate(input: ReplanTailInput): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  const sorted = [...input.allTrips].sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );
  const idx = sorted.findIndex((t) => t.id === input.tripId);
  if (idx < 0) {
    return {
      result: planLogistics({
        mode: 'stage',
        orders: input.orders,
        mixers: input.mixers,
        lockedTrips: input.allTrips.filter((t) => t.locked || t.done),
        doneOrderIds: input.doneOrderIds,
        allowNight: input.allowNight,
        useTraffic: input.useTraffic,
        factDelayMin: input.factDelayMin,
        nowMinutes: input.nowMinutes,
        calibration: input.calibration,
      }),
      locked: [],
      shifted: null,
    };
  }

  const shifted = input.mutate(sorted[idx]);
  const lockedMap = new Map<string, PlannedTrip>();
  for (let i = 0; i <= idx; i++) {
    const t = i === idx ? shifted : { ...sorted[i], locked: true };
    lockedMap.set(t.id, t);
  }
  for (const t of sorted.slice(idx + 1)) {
    if (t.locked || t.done) lockedMap.set(t.id, { ...t, locked: true });
  }
  const locked = [...lockedMap.values()].sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );

  const live = applyLiveFactToOrders(input.orders, input.dayTrips || [], {
    nowMinutes: input.nowMinutes,
  });

  const result = planLogistics({
    mode: 'stage',
    orders: live.orders,
    mixers: input.mixers,
    lockedTrips: locked,
    doneOrderIds: input.doneOrderIds,
    allowNight: input.allowNight,
    useTraffic: input.useTraffic,
    factDelayMin: input.factDelayMin,
    nowMinutes: input.nowMinutes,
    calibration: input.calibration,
  });

  return { result, locked, shifted };
}

/**
 * Сдвиг одного рейса по loadTime → голова дня locked, хвост пересчитывается stage.
 */
export function replanAfterManualTripShift(input: {
  allTrips: PlannedTrip[];
  tripId: string;
  newLoadAtMin: number;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
}): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  return replanTailAfterTripMutate({
    ...input,
    mutate: (t) => applyManualLoadShiftToTrip(t, input.newLoadAtMin),
  });
}

/**
 * Задержка на рейсе (+N мин разгрузки) → фиксация рейса, пересчёт хвоста.
 */
export function replanAfterTripDelay(input: {
  allTrips: PlannedTrip[];
  tripId: string;
  delayMin: number;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
}): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  return replanTailAfterTripMutate({
    ...input,
    mutate: (t) => applyTripDelayMinutes(t, input.delayMin),
  });
}

/** Правка планового объёма рейса → пересчёт load/arrive/return и фиксация. */
export function applyTripPlanVolume(trip: PlannedTrip, volume: number): PlannedTrip {
  const vol = Math.round(Math.max(0.1, Math.min(20, Number(volume) || 0)) * 10) / 10;
  const loadMin = loadMinutesForVolume(vol);
  const unloadMin = Math.max(0, Number(trip.unloadMin) || PLANNER_UNLOAD_MIN);
  const delay = Math.max(0, Math.round(Number(trip.delayMin) || 0));
  const loadAt = trip.loadAtMin ?? parseHhMm(trip.loadTime) ?? 0;
  const isPu = Boolean(trip.pickup || trip.mixerNumber === PICKUP_MIXER_NUMBER);
  if (isPu) {
    const ready = loadAt + loadMin;
    return {
      ...trip,
      volume: vol,
      loadMin,
      loadAtMin: loadAt,
      loadTime: formatMinutes(loadAt),
      arriveAtMin: ready,
      arriveTime: formatMinutes(ready),
      unloadDoneTime: formatMinutes(ready),
      returnAtMin: ready,
      returnTime: '—',
      locked: true,
    };
  }
  const road = Math.max(0, Number(trip.roadMin) || 0);
  const arrive = loadAt + loadMin + road;
  const unloadDone = arrive + unloadMin;
  const returnAt = unloadDone + road;
  return {
    ...trip,
    volume: vol,
    loadMin,
    loadAtMin: loadAt,
    loadTime: formatMinutes(loadAt),
    arriveAtMin: arrive,
    arriveTime: formatMinutes(arrive),
    unloadDoneTime: formatMinutes(unloadDone),
    returnAtMin: returnAt,
    returnTime: formatMinutes(returnAt),
    delayMin: delay || undefined,
    locked: true,
  };
}

/**
 * Смена объёма рейса (бочка забита и т.п.) → фиксация рейса, хвост stage.
 * В `mixers` передавай парк с уже уменьшенной вместимостью миксера.
 */
export function replanAfterTripVolumeChange(input: {
  allTrips: PlannedTrip[];
  tripId: string;
  volume: number;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
}): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  return replanTailAfterTripMutate({
    ...input,
    mutate: (t) => applyTripPlanVolume(t, input.volume),
  });
}

/**
 * Несколько правок объёма (например sync из ручных order_mixers) → одна волна хвоста.
 * Объёмы применяются сразу; рейсы с новой вместимостью locked, хвост — stage.
 */
export function replanAfterTripVolumesChange(input: {
  allTrips: PlannedTrip[];
  changes: Array<{ tripId: string; volume: number }>;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
}): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  const volById = new Map<string, number>();
  for (const c of input.changes) {
    if (!c.tripId) continue;
    volById.set(
      c.tripId,
      Math.round(Math.max(0.1, Math.min(20, Number(c.volume) || 0)) * 10) / 10,
    );
  }
  if (volById.size === 0) {
    return {
      result: planLogistics({
        mode: 'stage',
        orders: input.orders,
        mixers: input.mixers,
        lockedTrips: input.allTrips.filter((t) => t.locked || t.done),
        doneOrderIds: input.doneOrderIds,
        allowNight: input.allowNight,
        useTraffic: input.useTraffic,
        factDelayMin: input.factDelayMin,
        calibration: input.calibration,
      }),
      locked: [],
      shifted: null,
    };
  }

  const withVols = input.allTrips.map((t) => {
    const v = volById.get(t.id);
    return v != null ? applyTripPlanVolume(t, v) : t;
  });

  const sorted = [...withVols].sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );
  const earliest = sorted.find((t) => volById.has(t.id));
  if (!earliest) {
    return {
      result: planLogistics({
        mode: 'stage',
        orders: input.orders,
        mixers: input.mixers,
        lockedTrips: withVols.filter((t) => t.locked || t.done),
        doneOrderIds: input.doneOrderIds,
        allowNight: input.allowNight,
        useTraffic: input.useTraffic,
        factDelayMin: input.factDelayMin,
        calibration: input.calibration,
      }),
      locked: [],
      shifted: null,
    };
  }

  return replanTailAfterTripMutate({
    allTrips: withVols,
    tripId: earliest.id,
    orders: input.orders,
    mixers: input.mixers,
    doneOrderIds: input.doneOrderIds,
    allowNight: input.allowNight,
    useTraffic: input.useTraffic,
    factDelayMin: input.factDelayMin,
    dayTrips: input.dayTrips,
    nowMinutes: input.nowMinutes,
    calibration: input.calibration,
    // объём уже применён; фиксируем голову от earliest
    mutate: (t) => t,
  });
}

/**
 * Перетаскивание рейса: внутри заявки или в другую заявку.
 * Вставляем beforeTripId (или в конец заявки), фиксируем голову, хвост пересчитываем.
 */
export function replanAfterTripReorder(input: {
  allTrips: PlannedTrip[];
  tripId: string;
  targetOrderId: string | number;
  /** null/undefined — в конец рейсов целевой заявки (по текущему времени) */
  beforeTripId?: string | null;
  orders: PlannerOrder[];
  mixers: PlannerMixer[];
  doneOrderIds?: Array<number | string>;
  allowNight?: boolean;
  useTraffic?: boolean;
  factDelayMin?: number;
  dayTrips?: LiveTripFact[];
  nowMinutes?: number | null;
  calibration?: PlannerCalibration | null;
}): {
  result: PlanLogisticsResult;
  locked: PlannedTrip[];
  shifted: PlannedTrip | null;
} {
  const targetOid = String(input.targetOrderId);
  const order = input.orders.find((o) => String(o.id) === targetOid);
  const sorted = [...input.allTrips].sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );
  const fromIdx = sorted.findIndex((t) => t.id === input.tripId);
  if (fromIdx < 0) {
    return replanTailAfterTripMutate({
      ...input,
      mutate: (t) => t,
    });
  }

  const moving = sorted[fromIdx];
  if (moving.done || moving.pickup || moving.mixerNumber === PICKUP_MIXER_NUMBER) {
    return {
      result: planLogistics({
        mode: 'stage',
        orders: input.orders,
        mixers: input.mixers,
        lockedTrips: input.allTrips.filter((t) => t.locked || t.done),
        doneOrderIds: input.doneOrderIds,
        allowNight: input.allowNight,
        useTraffic: input.useTraffic,
        factDelayMin: input.factDelayMin,
        calibration: input.calibration,
      }),
      locked: [],
      shifted: null,
    };
  }

  const without = sorted.filter((t) => t.id !== input.tripId);
  let insertIdx = without.length;
  if (input.beforeTripId) {
    const bi = without.findIndex((t) => t.id === input.beforeTripId);
    if (bi >= 0) insertIdx = bi;
  } else {
    let lastOfOrder = -1;
    for (let i = 0; i < without.length; i++) {
      if (String(without[i].orderId) === targetOid) lastOfOrder = i;
    }
    insertIdx = lastOfOrder >= 0 ? lastOfOrder + 1 : without.length;
  }

  // Слот по времени: у соседа «перед нами» / прежнее время / после предыдущего
  let slotLoad =
    moving.loadAtMin ?? parseHhMm(moving.loadTime) ?? PLANT_OPEN_DEFAULT_MINUTES;
  if (input.beforeTripId) {
    const before = without.find((t) => t.id === input.beforeTripId);
    if (before) {
      slotLoad = before.loadAtMin ?? parseHhMm(before.loadTime) ?? slotLoad;
    }
  } else if (insertIdx > 0) {
    const prev = without[insertIdx - 1];
    const prevLoad = prev.loadAtMin ?? parseHhMm(prev.loadTime) ?? slotLoad;
    const prevRet = prev.returnAtMin ?? parseHhMm(prev.returnTime);
    slotLoad = Math.max(slotLoad, prevRet != null ? prevRet : prevLoad);
  }

  // При переносе в другую заявку — дорога от целевого адреса (не старого).
  let roadForMove = Math.max(0, Number(moving.roadMin) || 0);
  if (order && String(moving.orderId) !== targetOid) {
    const baseRoad = Math.max(5, Number(order.roadMin) || 30);
    roadForMove = roadWithTraffic(baseRoad, slotLoad, Boolean(input.useTraffic));
  }

  const relocated = applyManualLoadShiftToTrip(
    {
      ...moving,
      orderId: order?.id ?? input.targetOrderId,
      client: order?.client || moving.client,
      roadMin: roadForMove,
    },
    slotLoad,
  );

  const nextSeq = [...without.slice(0, insertIdx), relocated, ...without.slice(insertIdx)];
  const lockedMap = new Map<string, PlannedTrip>();
  for (let i = 0; i <= insertIdx; i++) {
    const t = nextSeq[i];
    lockedMap.set(t.id, i === insertIdx ? relocated : { ...t, locked: true });
  }
  for (const t of nextSeq.slice(insertIdx + 1)) {
    if (t.locked || t.done) lockedMap.set(t.id, { ...t, locked: true });
  }
  const locked = [...lockedMap.values()].sort(
    (a, b) => tripLoadSortKey(a) - tripLoadSortKey(b),
  );

  const live = applyLiveFactToOrders(input.orders, input.dayTrips || [], {
    nowMinutes: input.nowMinutes,
  });

  const result = planLogistics({
    mode: 'stage',
    orders: live.orders,
    mixers: input.mixers,
    lockedTrips: locked,
    doneOrderIds: input.doneOrderIds,
    allowNight: input.allowNight,
    useTraffic: input.useTraffic,
    factDelayMin: input.factDelayMin,
    calibration: input.calibration,
  });

  return { result, locked, shifted: relocated };
}
