'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Copy,
  Calculator,
  Layers,
  RefreshCw,
  Lock,
  Route,
  Database,
  Upload,
  Send,
} from 'lucide-react';
import ModalActionButton from './ModalActionButton';
import PlannerTripFactRow from './PlannerTripFactRow';
import PlannerOperatorView from './PlannerOperatorView';
import PlannerInsightsPanel from './PlannerInsightsPanel';
import PlannerOrderHeader from './PlannerOrderHeader';
import PlannerFleetMixerChip from './PlannerFleetMixerChip';
import DarkHoverTip from './DarkHoverTip';
import PlannerSwitch from './PlannerSwitch';
import { appAlert, appConfirm } from './appDialog';
import { useUserRole } from '@/app/providers/UserRoleProvider';
import {
  parseCalibrationPayload,
  toCalibrationSourceMeta,
  type PlannerCalibration,
} from '@/lib/plannerCalibration';
import {
  buildFleetHint,
  buildPlannerScenarios,
  ensureFleetForWindow,
  estimateDayFleetNeed,
  fleetHintFromPlan,
  formatFleetGrowAdvice,
  formatOwnRented,
  getPlanDayBounds,
  applyLiveFactToOrders,
  applyManualLoadShiftToTrip,
  isPickupOrder,
  liveShippedVolumeForOrder,
  nowMinutesIfDateKeyIsToday,
  orderProgressStatus,
  orphanLiveTripsAsPlanned,
  PICKUP_MIXER_NUMBER,
  PLANNER_FACT_SHIPPED_STATUSES,
  formatPlannerWaveLabel,
  makePlannerWave,
  medianFactDelayMin,
  nextWaveStageIndex,
  parsePlanHhMm,
  planLogistics,
  rankFleetForDay,
  replanAfterManualTripShift,
  replanAfterTripDelay,
  replanAfterTripReorder,
  replanAfterTripVolumeChange,
  replanAfterTripVolumesChange,
  resolvePlantOpenMinutes,
  uniquifyPlannedTripIds,
  type PlannedTrip,
  type PlannerMixer,
  type PlannerMixerGps,
  type PlannerOrder,
  type PlannerOrderShift,
  type PlannerScenario,
  type PlannerWarning,
  type PlannerWave,
} from '@/lib/logisticsPlanner';
import {
  liveTripHasReleaseFact,
  matchAllPlanTripsToFact,
  mixerPlatesEqual,
  type FactProductionLog,
} from '@/lib/plannerFactMatch';
import {
  buildUnifiedDailyPlanText,
  type DailyReportOrderGroup,
} from '@/lib/dailyMixerReport';
import {
  canEditDailyLogisticsPlan,
  formatPlanUpdatedAtLabel,
  isPlanEditingFresh,
  normalizePlanDateKey,
  type DailyLogisticsPlanPayload,
  type DailyLogisticsPlanRow,
} from '@/lib/dailyLogisticsPlan';
import { extractCoordsFromAddress } from '@/lib/geocodeAddress';
import {
  scoutIsOnline,
  type FleetTelemetrySnapshot,
} from '@/lib/fleetLifecycle';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { CARD_GRADIENT_SOFT, volumeCardStyle } from '../cardStyles';
import { useRealtimeProductionLogs } from '@/hooks/useRealtimeOrders';
import {
  useRealtimeDailyLogisticsPlan,
  type SharedLogisticsPlanRecord,
} from '@/hooks/useRealtimeDailyLogisticsPlan';
import { pluralRu, withSelectedMixersPhrase } from '@/lib/ruLocale';
import type { CSSProperties, ReactNode } from 'react';

/** dateKey дашборда (YYYY-M-D) → YYYY-MM-DD для API. */
function toApiDateKey(dateKey: string): string {
  const parts = String(dateKey || '').split('-').map((x) => parseInt(x, 10));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return dateKey;
  const [y, m, d] = parts;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const PLAN_DRAFT_PREFIX = 'logisticsPlan_';

export type LogisticsPlannerOrderInput = {
  id: number | string;
  organization_name?: string | null;
  full_name?: string | null;
  delivery_time?: string | null;
  volume?: number | string | null;
  address?: string | null;
  grade?: string | null;
  status?: string | null;
  road_time_min?: number | null;
};

export type LogisticsPlannerTripInput = {
  id?: number | string;
  orderId?: number | string | null;
  order_id?: number | string | null;
  number?: string | null;
  mixer_name?: string | null;
  volume?: number | string | null;
  status?: string | null;
  time?: string | null;
  loading_started_at?: string | null;
  loadingStartedAt?: string | null;
};

type FleetRow = {
  id: number | string;
  number: string;
  volume: number;
  type: string;
  unload_allowance_min?: number | null;
  model?: string | null;
  driver?: string | null;
  driverPhone?: string | null;
  lifecycle_status?: string | null;
};

type Props = {
  dateKey: string;
  dateLabel: string;
  orders: LogisticsPlannerOrderInput[];
  /** Уже назначенные рейсы дня (live) */
  dayTrips: LogisticsPlannerTripInput[];
  /** roadTimes[orderId] */
  roadTimes: Record<string, number>;
  /** После принудительного пересчёта дорог — обновить кэш на дашборде. */
  onRoadTimesUpdate?: (times: Record<string, number>) => void;
  /** Группы заявок для единого отчёта Макс (рейсы под заявками). */
  reportGroups?: DailyReportOrderGroup[];
  /** Подпись даты в шапке отчёта («пятницу, 31 июля»). */
  reportDateLabel?: string;
  onLineCount?: number;
  /** Открыть модалку текста Макс: оперативный (без выполненных) + полный день. */
  onApplyMaxText: (payload: { activeText: string; fullDayText: string }) => void;
  /** Масштаб UI (1 / 1.1 / 1.2 под 1600 / 1920 / 4K). */
  uiScale?: number;
  /** Раскладка: страница (две колонки) или компактная колонка. */
  layout?: 'page' | 'modal';
  /** Узкий экран: колонки стопкой. */
  compactSide?: boolean;
};

type DraftState = {
  selectedMixerIds: string[];
  lockedTrips: PlannedTrip[];
  manualDoneOrderIds: string[];
  trips: PlannedTrip[];
  allowNight?: boolean;
  useTraffic?: boolean;
  useLiveGps?: boolean;
  orderShifts?: PlannerOrderShift[];
  warnings?: PlannerWarning[];
  waves?: PlannerWave[];
  mixerVolumeOverrides?: Record<string, number>;
};

/** Свежие online GPS → карта для planLogistics. */
function mixerGpsFromTelemetry(
  rows: FleetTelemetrySnapshot[],
): Record<string, PlannerMixerGps> {
  const out: Record<string, PlannerMixerGps> = {};
  for (const row of rows) {
    const lat = row.lat != null ? Number(row.lat) : NaN;
    const lon = row.lon != null ? Number(row.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    const online = row.is_online || scoutIsOnline(row.last_message_at);
    if (!online) continue;
    out[String(row.mixer_id)] = {
      lat,
      lon,
      lastMessageAt: row.last_message_at,
      isOnline: true,
    };
  }
  return out;
}

function siteCoordsFromOrders(
  orders: PlannerOrder[],
): Record<string, { lat: number; lon: number }> {
  const out: Record<string, { lat: number; lon: number }> = {};
  for (const o of orders) {
    const c = extractCoordsFromAddress(o.address);
    if (c) out[String(o.id)] = c;
  }
  return out;
}

type SharedPlanMeta = {
  revision: number;
  updatedAt: string | null;
  updatedByName: string | null;
  editingByName?: string | null;
  editingByUserId?: number | null;
  editingAt?: string | null;
};

function draftKey(dateKey: string) {
  return `${PLAN_DRAFT_PREFIX}${dateKey}`;
}

function loadDraft(dateKey: string): DraftState | null {
  try {
    const raw = localStorage.getItem(draftKey(dateKey));
    if (!raw) return null;
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

function saveDraft(dateKey: string, draft: DraftState) {
  try {
    localStorage.setItem(draftKey(dateKey), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

function payloadFromDraft(
  draft: DraftState,
  warnings: PlannerWarning[] = [],
): DailyLogisticsPlanPayload {
  return {
    selectedMixerIds: draft.selectedMixerIds,
    lockedTrips: draft.lockedTrips,
    manualDoneOrderIds: draft.manualDoneOrderIds,
    trips: draft.trips,
    allowNight: draft.allowNight,
    useTraffic: draft.useTraffic,
    useLiveGps: draft.useLiveGps,
    orderShifts: draft.orderShifts,
    warnings,
    waves: draft.waves,
    mixerVolumeOverrides: draft.mixerVolumeOverrides,
  };
}

function parseMixerVolumeOverrides(
  raw: unknown,
): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[String(k)] = Math.round(n * 10) / 10;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseSharedPayload(raw: unknown): DailyLogisticsPlanPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as DailyLogisticsPlanPayload;
  return {
    selectedMixerIds: Array.isArray(p.selectedMixerIds)
      ? p.selectedMixerIds.map(String)
      : [],
    lockedTrips: Array.isArray(p.lockedTrips) ? p.lockedTrips : [],
    manualDoneOrderIds: Array.isArray(p.manualDoneOrderIds)
      ? p.manualDoneOrderIds.map(String)
      : [],
    trips: Array.isArray(p.trips) ? p.trips : [],
    allowNight: Boolean(p.allowNight),
    useTraffic: Boolean(p.useTraffic),
    useLiveGps: Boolean(p.useLiveGps),
    orderShifts: Array.isArray(p.orderShifts) ? p.orderShifts : [],
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
    waves: Array.isArray(p.waves) ? p.waves : [],
    mixerVolumeOverrides: parseMixerVolumeOverrides(p.mixerVolumeOverrides),
  };
}

function actorDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('userName');
}

/** % выполнения плана заявки: отгруженный факт / объём заявки. */
export default function LogisticsPlannerTab({
  dateKey,
  dateLabel,
  orders,
  dayTrips,
  roadTimes,
  onRoadTimesUpdate,
  reportGroups = [],
  reportDateLabel,
  onLineCount,
  onApplyMaxText,
  uiScale = 1,
  layout = 'modal',
  compactSide = false,
}: Props) {
  const isPageLayout = layout === 'page';
  const stackColumns = isPageLayout && compactSide;
  const fs = (n: number) => Math.round(n * uiScale);
  const sp = (n: number) => Math.round(n * uiScale);
  const { user: roleUser } = useUserRole();
  const userRole = String(
    roleUser?.role ||
      (typeof window !== 'undefined' ? localStorage.getItem('userRole') : '') ||
      '',
  ).toLowerCase();
  const isOperatorView = userRole === 'operator';
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [stats, setStats] = useState<Record<string, { tripCount: number; volumeSum: number }>>({});
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trips, setTrips] = useState<PlannedTrip[]>([]);
  const [lockedTrips, setLockedTrips] = useState<PlannedTrip[]>([]);
  const [manualDone, setManualDone] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<PlannerWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [publishDirty, setPublishDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [staleConflict, setStaleConflict] = useState<{
    revision: number;
    updatedByName: string | null;
    updatedAt: string | null;
    record: SharedLogisticsPlanRecord;
  } | null>(null);
  const [autoStageNote, setAutoStageNote] = useState('');
  const [allowNight, setAllowNight] = useState(false);
  const [useTraffic, setUseTraffic] = useState(false);
  const [useLiveGps, setUseLiveGps] = useState(false);
  const [scenarios, setScenarios] = useState<PlannerScenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [orderShifts, setOrderShifts] = useState<PlannerOrderShift[]>([]);
  /** Фаза 4: история волн дня */
  const [waves, setWaves] = useState<PlannerWave[]>([]);
  const [activeWaveId, setActiveWaveId] = useState<string | null>(null);
  const [fleetGrowNote, setFleetGrowNote] = useState('');
  const wavesRef = useRef<PlannerWave[]>([]);
  const [localRoadTimes, setLocalRoadTimes] = useState<Record<string, number>>(roadTimes);
  const [roadsRefreshing, setRoadsRefreshing] = useState(false);
  const [roadsNote, setRoadsNote] = useState('');
  /** Опция: применять план только к отмеченным заявкам (не ко всем). */
  const [applyOnlySelected, setApplyOnlySelected] = useState(false);
  /** Опасно: затирать ручные «Загрузка» диспетчера. По умолчанию выкл. */
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [applyOrderIds, setApplyOrderIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  /** Фаза 5: лог оператора за день (GET + realtime). */
  const [productionLogs, setProductionLogs] = useState<FactProductionLog[]>([]);
  /** Фаза 6: мета общего плана дня. */
  const [sharedMeta, setSharedMeta] = useState<SharedPlanMeta | null>(null);
  const [canEditPlan, setCanEditPlan] = useState(true);
  /** V2: калибровка норм из истории */
  const [calibration, setCalibration] = useState<PlannerCalibration | null>(null);
  const calibrationRef = useRef<PlannerCalibration | null>(null);
  /** Правки вместимости миксера на день (номер → м³) */
  const [mixerVolumeOverrides, setMixerVolumeOverrides] = useState<
    Record<string, number>
  >({});
  const mixerVolumeOverridesRef = useRef<Record<string, number>>({});
  /** DnD рейсов в окне интеллекта */
  const [dragTripId, setDragTripId] = useState<string | null>(null);
  /** Синхронный id — state на drop может ещё быть null (React не успел отрисовать). */
  const dragTripIdRef = useRef<string | null>(null);
  const [dragOverTripId, setDragOverTripId] = useState<string | null>(null);
  const [dragOverOrderId, setDragOverOrderId] = useState<string | null>(null);
  const dayOrderIdSet = useMemo(
    () => new Set(orders.map((o) => String(o.id))),
    [orders],
  );

  const suppressPublishRef = useRef(true);
  const localRevisionRef = useRef(0);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningsRef = useRef<PlannerWarning[]>([]);
  const draftSnapshotRef = useRef<DraftState | null>(null);
  /** После hydrate: локальный черновик есть, в БД ещё нет — опубликовать один раз. */
  const migrateLocalToSharedRef = useRef(false);
  const applyRemoteRef = useRef<(record: SharedLogisticsPlanRecord) => void>(
    () => {},
  );
  const runPlanRef = useRef<
    (mode: 'full_day' | 'stage', opts?: { silent?: boolean }) => Promise<void>
  >(async () => {});
  const lastAutoStageDelayRef = useRef(0);
  const autoStageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStageReadyAtRef = useRef(0);
  /** Авто-этап при «Загрузка» диспетчера: не крутить один и тот же беспорядок. */
  const autoLoadingStageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastLoadingStageKeyRef = useRef('');
  /** Ключ уже запланированного автоэтапа — таймер НЕ сбрасываем на каждый realtime-тик. */
  const pendingLoadingStageKeyRef = useRef<string | null>(null);
  const autoLoadingStageReadyAtRef = useRef(0);
  const stickySyncRef = useRef(false);
  /** Снимок volume по order_mixers.id — чтобы ловить ручные add/правку диспетчера. */
  const factVolSnapshotRef = useRef<Map<string, number>>(new Map());
  const factVolSeededRef = useRef(false);
  const pendingFactVolSyncRef = useRef<Set<string>>(new Set());
  const pendingSeedVolCatchUpRef = useRef(false);
  const factVolSyncingRef = useRef(false);

  useEffect(() => {
    setCanEditPlan(canEditDailyLogisticsPlan(userRole));
  }, [userRole]);

  useEffect(() => {
    factVolSnapshotRef.current = new Map();
    factVolSeededRef.current = false;
    pendingFactVolSyncRef.current = new Set();
    pendingSeedVolCatchUpRef.current = false;
    factVolSyncingRef.current = false;
  }, [dateKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/adminCifra/logistics-plan/insights?date=${encodeURIComponent(toApiDateKey(dateKey))}`,
          { headers: adminCifraAuthHeaders(), cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        const calib = parseCalibrationPayload(
          data?.calibrationFull || data?.calibration || null,
        );
        if (!cancelled) {
          calibrationRef.current = calib;
          setCalibration(calib);
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  useRealtimeProductionLogs(setProductionLogs, { enabled: true });

  useEffect(() => {
    let cancelled = false;
    const apiDate = toApiDateKey(dateKey);
    (async () => {
      try {
        const res = await fetch(
          `/api/adminCifra/production-log?date=${encodeURIComponent(apiDate)}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        setProductionLogs(data as FactProductionLog[]);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  /** Realtime может принести логи чужих дней — оставляем заявки текущего дня. */
  const dayProductionLogs = useMemo(() => {
    return productionLogs.filter((l) => {
      if (l.order_id != null && dayOrderIdSet.has(String(l.order_id))) return true;
      const dd = String(l.delivery_date || '').substring(0, 10);
      return dd === toApiDateKey(dateKey);
    });
  }, [productionLogs, dayOrderIdSet, dateKey]);

  const planFactByTripId = useMemo(() => {
    // Сначала матч обычных слотов плана, затем orphan-live (ручные рейсы заявки
    // без слота) — чтобы «В пути» не терялся, когда плана по заявке нет.
    const base = matchAllPlanTripsToFact(trips, dayTrips, dayProductionLogs);
    const usedOm = new Set(
      [...base.values()]
        .map((f) => f.matchedTripId)
        .filter((id): id is number => id != null && id > 0)
        .map(String),
    );
    const withOrphans = [...trips];
    // plannerOrders объявлен ниже — берём заявки дня из props.orders.
    for (const raw of orders) {
      if (String(raw.status || '').toLowerCase() === 'cancelled') continue;
      const o = {
        id: raw.id,
        client: String(raw.organization_name || raw.full_name || '—').trim() || '—',
        deliveryTime: String(raw.delivery_time || '').slice(0, 5) || '00:00',
        volume: Number(raw.volume) || 0,
        address: String(raw.address || '').trim(),
        grade: String(raw.grade || ''),
        status: String(raw.status || ''),
        roadMin: isPickupOrder(String(raw.address || ''))
          ? 0
          : localRoadTimes[String(raw.id)] ??
            roadTimes[String(raw.id)] ??
            (raw.road_time_min != null ? Number(raw.road_time_min) : 30),
      };
      const planned = trips.filter((t) => String(t.orderId) === String(o.id));
      for (const orphan of orphanLiveTripsAsPlanned(o, dayTrips, planned)) {
        const om = orphan.orderMixerId != null ? String(orphan.orderMixerId) : '';
        if (om && usedOm.has(om)) continue;
        withOrphans.push(orphan);
        if (om) usedOm.add(om);
      }
    }
    if (withOrphans.length === trips.length) return base;
    return matchAllPlanTripsToFact(withOrphans, dayTrips, dayProductionLogs);
  }, [trips, dayTrips, dayProductionLogs, orders, localRoadTimes, roadTimes]);

  const myUserId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const raw = Number(localStorage.getItem('userId'));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, []);

  const editingOther = useMemo(() => {
    return (
      Boolean(sharedMeta?.editingByName) &&
      isPlanEditingFresh(sharedMeta?.editingAt) &&
      sharedMeta?.editingByUserId != null &&
      myUserId != null &&
      Number(sharedMeta.editingByUserId) !== myUserId
    );
  }, [sharedMeta, myUserId]);

  /** Роль + нет чужой живой блокировки */
  const canMutatePlan = canEditPlan && !editingOther;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Closed-loop: авто-этап при росте опоздания факта (без ручного «Рассчитать этап»)
  useEffect(() => {
    autoStageReadyAtRef.current = Date.now() + 45_000;
    autoLoadingStageReadyAtRef.current = Date.now() + 8_000;
    lastAutoStageDelayRef.current = 0;
    lastLoadingStageKeyRef.current = '';
    pendingLoadingStageKeyRef.current = null;
    if (autoLoadingStageTimerRef.current) {
      clearTimeout(autoLoadingStageTimerRef.current);
      autoLoadingStageTimerRef.current = null;
    }
  }, [dateKey]);

  const isLiveActivePlanFact = useCallback((tripId: string) => {
    const f = planFactByTripId.get(tripId);
    if (!f?.hasMatch) return false;
    const st = String(f.factStatus || '');
    if (st === 'Загрузка' || st === 'Проблема') return true;
    if ((PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st)) {
      return true;
    }
    return Boolean(f.factRelease);
  }, [planFactByTripId]);

  // WATCHPOINT 01.08.2026 — автоэтап по «Загрузке» (live-очередь).
  // Каждый срабатывание = commitWavePlan → publish shared plan (как ручной «Этап»).
  // Важно: таймер НЕ чистим в cleanup эффекта — иначе realtime (dayTrips/факт)
  // каждые ~1с сбрасывал debounce и этап никогда не стартовал.
  // Если broadcast/UI начнёт тормозить — debounce↑ / без immediate / coalesce.
  useEffect(() => {
    if (!canMutatePlan || loadingFleet || isOperatorView) return;
    if (!trips.length) return;
    if (nowMinutesIfDateKeyIsToday(dateKey) == null) return;
    if (Date.now() < autoLoadingStageReadyAtRef.current) return;

    const byOrder = new Map<string, PlannedTrip[]>();
    for (const t of trips) {
      if (t.done) continue;
      const oid = String(t.orderId);
      const list = byOrder.get(oid) || [];
      list.push(t);
      byOrder.set(oid, list);
    }

    const disorderParts: string[] = [];
    for (const [oid, list] of byOrder) {
      list.sort((a, b) => {
        const ka = a.loadAtMin ?? parsePlanHhMm(String(a.loadTime)) ?? 0;
        const kb = b.loadAtMin ?? parsePlanHhMm(String(b.loadTime)) ?? 0;
        return ka - kb || String(a.id).localeCompare(String(b.id));
      });
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!isLiveActivePlanFact(t.id)) continue;
        const fact = planFactByTripId.get(t.id);
        const st = String(fact?.factStatus || '');
        if (
          st !== 'Загрузка' &&
          !(PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st)
        ) {
          continue;
        }
        const ghostsBefore = list
          .slice(0, i)
          .filter((prev) => !isLiveActivePlanFact(prev.id));
        if (ghostsBefore.length === 0) continue;
        // Ключ без статуса: Загрузка→В пути не должен сбрасывать ожидание.
        disorderParts.push(
          `${oid}:${t.id}:${fact?.matchedTripId || ''}:` +
            ghostsBefore.map((g) => g.id).join(','),
        );
      }
    }

    if (disorderParts.length === 0) {
      pendingLoadingStageKeyRef.current = null;
      if (autoLoadingStageTimerRef.current) {
        clearTimeout(autoLoadingStageTimerRef.current);
        autoLoadingStageTimerRef.current = null;
      }
      return;
    }

    const disorderKey = disorderParts.sort().join('|');
    if (disorderKey === lastLoadingStageKeyRef.current) return;
    // Уже ждём этот же беспорядок — не трогаем таймер (realtime-тики).
    if (pendingLoadingStageKeyRef.current === disorderKey) return;

    if (autoLoadingStageTimerRef.current) {
      clearTimeout(autoLoadingStageTimerRef.current);
    }
    pendingLoadingStageKeyRef.current = disorderKey;

    const tryRun = (attempt: number) => {
      autoLoadingStageTimerRef.current = null;
      if (pendingLoadingStageKeyRef.current !== disorderKey) return;
      // stickySync не ждём — иначе live-синк времени вечно откладывал этап.
      if (busyRef.current || factVolSyncingRef.current) {
        if (attempt < 16) {
          autoLoadingStageTimerRef.current = setTimeout(
            () => tryRun(attempt + 1),
            400,
          );
          return;
        }
        pendingLoadingStageKeyRef.current = null;
        return;
      }
      pendingLoadingStageKeyRef.current = null;
      setAutoStageNote(
        'Автоэтап: миксеры в «Загрузке» поднимаю вверх, хвост пересчитываю…',
      );
      // silent: не спамить модалкой, если день уже закрыт по факту.
      void runPlanRef.current('stage', { silent: true }).finally(() => {
        // Если фантомы остались — не блокируем повтор тем же fingerprint.
        lastLoadingStageKeyRef.current = disorderKey;
        window.setTimeout(() => {
          lastLoadingStageKeyRef.current = '';
        }, 4000);
        setAutoStageNote('Автоэтап: очередь подтянута по факту загрузки');
        window.setTimeout(() => setAutoStageNote(''), 8000);
      });
    };

    autoLoadingStageTimerRef.current = setTimeout(() => tryRun(0), 2000);
    // cleanup намеренно нет — иначе realtime сбрасывает debounce.
  }, [
    planFactByTripId,
    trips,
    canMutatePlan,
    loadingFleet,
    isOperatorView,
    dateKey,
    isLiveActivePlanFact,
  ]);

  useEffect(() => {
    if (!canMutatePlan || busy || loadingFleet || isOperatorView) return;
    if (!trips.length) return;
    if (nowMinutesIfDateKeyIsToday(dateKey) == null) return;
    if (Date.now() < autoStageReadyAtRef.current) return;

    const delay = medianFactDelayMin(
      [...planFactByTripId.values()].map((f) => f.deltaLoadMin ?? f.deltaReleaseMin),
    );
    const hasLiveLate = [...planFactByTripId.values()].some(
      (f) => f.hasMatch && (f.deltaLoadMin ?? f.deltaReleaseMin ?? 0) > 5,
    );
    if (!hasLiveLate || delay < 8) return;
    if (delay <= lastAutoStageDelayRef.current + 4) return;

    if (autoStageTimerRef.current) clearTimeout(autoStageTimerRef.current);
    autoStageTimerRef.current = setTimeout(() => {
      autoStageTimerRef.current = null;
      if (busy) return;
      lastAutoStageDelayRef.current = delay;
      setAutoStageNote(`Автосдвиг по факту: опоздание ~${delay} мин — пересчитываю этап…`);
      void runPlanRef.current('stage', { silent: true }).finally(() => {
        setAutoStageNote(`Автосдвиг по факту учёл опоздание ~${delay} мин`);
        window.setTimeout(() => setAutoStageNote(''), 8000);
      });
    }, 14000);

    return () => {
      if (autoStageTimerRef.current) clearTimeout(autoStageTimerRef.current);
    };
  }, [
    planFactByTripId,
    canMutatePlan,
    busy,
    loadingFleet,
    isOperatorView,
    trips.length,
    dateKey,
  ]);

  // Heartbeat «сейчас правит…» (не перехватываем чужой — см. forceTakeover)
  useEffect(() => {
    if (!canEditPlan || loadingFleet || isOperatorView) return;
    const apiDate = normalizePlanDateKey(toApiDateKey(dateKey)) || toApiDateKey(dateKey);
    let cancelled = false;

    const beat = async (editing: boolean) => {
      try {
        const res = await fetch('/api/adminCifra/logistics-plan', {
          method: 'PATCH',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ date: apiDate, editing }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (data?.skipped === 'locked_by_other') {
          const plan = data?.plan as DailyLogisticsPlanRow | undefined;
          setSharedMeta((prev) => ({
            revision: Number(plan?.revision) || prev?.revision || 0,
            updatedAt: plan?.updated_at || prev?.updatedAt || null,
            updatedByName: plan?.updated_by_name || prev?.updatedByName || null,
            editingByName:
              (plan?.editing_by_name || data.editingByName || prev?.editingByName) ??
              'коллега',
            editingByUserId:
              plan?.editing_by_user_id ?? prev?.editingByUserId ?? null,
            editingAt: plan?.editing_at || prev?.editingAt || null,
          }));
          return;
        }
        const plan = data?.plan as DailyLogisticsPlanRow | undefined;
        if (plan) {
          setSharedMeta((prev) => ({
            revision: prev?.revision ?? (Number(plan.revision) || 0),
            updatedAt: prev?.updatedAt ?? plan.updated_at ?? null,
            updatedByName: prev?.updatedByName ?? plan.updated_by_name ?? null,
            editingByName: plan.editing_by_name || null,
            editingByUserId: plan.editing_by_user_id ?? null,
            editingAt: plan.editing_at || null,
          }));
        }
      } catch {
        /* ignore */
      }
    };

    void beat(true);
    // 50 с: сервер всё равно skip'ает UPDATE, пока editing_at свежий (~90 с).
    // Раньше 25 с × полный payload в broadcast перегружали realtime.
    const id = window.setInterval(() => void beat(true), 50000);
    return () => {
      cancelled = true;
      clearInterval(id);
      void beat(false);
    };
  }, [canEditPlan, loadingFleet, isOperatorView, dateKey]);

  const orderIdsKey = useMemo(
    () =>
      orders
        .map((o) => String(o.id))
        .sort()
        .join(','),
    [orders],
  );

  const refreshRoadTimes = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!orders.length) return;
      const pickupOrders = orders.filter((o) => isPickupOrder(o.address));
      const deliveryOrders = orders.filter((o) => !isPickupOrder(o.address));

      // Самовывоз → 0 мин (и в локальный кэш, и в БД через force).
      const pickupTimes: Record<string, number> = {};
      for (const o of pickupOrders) pickupTimes[String(o.id)] = 0;

      if (deliveryOrders.length === 0) {
        setLocalRoadTimes((prev) => ({ ...prev, ...pickupTimes }));
        onRoadTimesUpdate?.({ ...pickupTimes });
        if (pickupOrders.length > 0) {
          void fetch('/api/adminCifra/travel-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              force: true,
              batch: pickupOrders.map((o) => ({
                orderId: o.id,
                address: o.address || '',
              })),
            }),
          }).catch(() => {});
        }
        if (!opts?.silent) setRoadsNote('Самовывоз — дороги = 0 мин');
        return;
      }

      setRoadsRefreshing(true);
      if (!opts?.silent) setRoadsNote('Пересчитываю дороги (сброс кэша)…');
      try {
        const res = await fetch('/api/adminCifra/travel-time', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force: true,
            batch: [
              ...deliveryOrders.map((o) => ({
                orderId: o.id,
                address: o.address || '',
              })),
              ...pickupOrders.map((o) => ({
                orderId: o.id,
                address: o.address || '',
              })),
            ],
          }),
        });
        if (!res.ok) {
          setRoadsNote('Не удалось обновить дороги — считаю по старому кэшу');
          return;
        }
        const data = await res.json();
        const times = { ...pickupTimes, ...((data.times || {}) as Record<string, number>) };
        let changed = 0;
        let next: Record<string, number> = {};
        setLocalRoadTimes((prev) => {
          next = { ...prev };
          for (const [id, min] of Object.entries(times)) {
            if (typeof min === 'number') {
              if (next[id] !== min) changed += 1;
              next[id] = min;
            }
          }
          return next;
        });
        onRoadTimesUpdate?.(next);
        const deliveryMins = Object.entries(times)
          .filter(([id]) => !pickupTimes[id])
          .map(([, min]) => min);
        const avg =
          deliveryMins.length > 0
            ? Math.round(deliveryMins.reduce((s, n) => s + n, 0) / deliveryMins.length)
            : 0;
        setRoadsNote(
          `Дороги пересчитаны (формула v3): ${deliveryMins.length} заявок` +
            (pickupOrders.length ? `, самовывоз ${pickupOrders.length}` : '') +
            (avg ? `, среднее ~${avg} мин` : '') +
            (changed ? `, изменено ${changed}` : ''),
        );
      } catch {
        setRoadsNote('Ошибка пересчёта дорог');
      } finally {
        setRoadsRefreshing(false);
      }
    },
    [orders, onRoadTimesUpdate],
  );

  // При открытии дня — всегда сбрасываем кэш дорог (старая 1.35/50 км·ч раздувала план).
  useEffect(() => {
    setLocalRoadTimes(roadTimes);
  }, [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps -- только смена дня

  useEffect(() => {
    if (!orderIdsKey) return;
    void refreshRoadTimes({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- раз при смене состава дня
  }, [dateKey, orderIdsKey]);

  // Менеджер сменил адрес → realtime принёс новый road_time_min в props.orders.
  // Подтягиваем в локальный кэш, иначе «объект/обр.» остаются по старой дороге.
  useEffect(() => {
    setLocalRoadTimes((prev) => {
      let next = prev;
      let changed = false;
      for (const o of orders) {
        const id = String(o.id);
        const m = isPickupOrder(o.address)
          ? 0
          : o.road_time_min != null
            ? Number(o.road_time_min)
            : NaN;
        if (!Number.isFinite(m) || prev[id] === m) continue;
        if (!changed) {
          next = { ...prev };
          changed = true;
        }
        next[id] = m;
      }
      return changed ? next : prev;
    });
  }, [orders]);

  const plannerOrders: PlannerOrder[] = useMemo(
    () =>
      orders
        .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
        .map((o) => ({
          id: o.id,
          client: String(o.organization_name || o.full_name || '—').trim() || '—',
          deliveryTime: String(o.delivery_time || '').slice(0, 5) || '00:00',
          volume: Number(o.volume) || 0,
          address: String(o.address || '').trim(),
          grade: String(o.grade || ''),
          status: String(o.status || ''),
          roadMin: isPickupOrder(o.address)
            ? 0
            : localRoadTimes[String(o.id)] ??
              roadTimes[String(o.id)] ??
              (o.road_time_min != null ? Number(o.road_time_min) : 30),
        })),
    [orders, localRoadTimes, roadTimes],
  );

  // Загрузка парка + статистики + общий план дня (БД → иначе localStorage)
  useEffect(() => {
    let cancelled = false;
    suppressPublishRef.current = true;
    (async () => {
      setLoadingFleet(true);
      try {
        const apiDate = toApiDateKey(dateKey);
        const [mixRes, statsRes, planRes] = await Promise.all([
          fetch('/api/adminCifra/mixers?kind=mixer'),
          fetch('/api/adminCifra/mixer-trip-stats'),
          fetch(
            `/api/adminCifra/logistics-plan?date=${encodeURIComponent(apiDate)}`,
            { headers: adminCifraAuthHeaders() },
          ),
        ]);
        const mixers = mixRes.ok ? await mixRes.json() : [];
        const statsJson = statsRes.ok ? await statsRes.json() : { stats: {} };
        if (cancelled) return;
        const rows: FleetRow[] = (Array.isArray(mixers) ? mixers : [])
          .filter((m: any) => m.status !== 'inactive' && m.status !== 'archived')
          // Фаза 2: ремонт / консервация / проданы — не в планировщике
          .filter((m: any) => {
            const lc = String(m.lifecycle_status || 'active');
            return lc !== 'repair' && lc !== 'conservation' && lc !== 'sold';
          })
          .map((m: any) => {
            const drivers = Array.isArray(m.mixer_drivers) ? m.mixer_drivers : [];
            const primary = drivers[0] || null;
            const driverName =
              String(m.driver || primary?.driver_name || '').trim() || null;
            const driverPhone =
              String(primary?.phone || '').trim() || null;
            return {
              id: m.id,
              number: String(m.number || ''),
              volume: Number(m.volume) || 0,
              type: m.type === 'rented' ? 'rented' : 'own',
              unload_allowance_min: m.unload_allowance_min ?? null,
              model: String(m.model || '').trim() || null,
              driver: driverName,
              driverPhone,
              lifecycle_status: String(m.lifecycle_status || 'active'),
            };
          })
          .filter((m: FleetRow) => m.number && m.volume > 0);
        setFleet(rows);
        setStats(statsJson.stats || {});

        let shared: DailyLogisticsPlanRow | null = null;
        if (planRes.ok) {
          const planJson = await planRes.json().catch(() => ({}));
          shared = (planJson?.plan as DailyLogisticsPlanRow | null) || null;
        }

        const dayOrderIds = new Set(orders.map((o) => String(o.id)));
        // Пустой список заявок на момент hydrate — не фильтруем (гонка загрузки).
        const onlyToday = (list: PlannedTrip[] | undefined) => {
          const raw = list || [];
          if (dayOrderIds.size === 0) return raw;
          return raw.filter((t) => dayOrderIds.has(String(t.orderId)));
        };

        const sharedPayload = shared ? parseSharedPayload(shared.payload) : null;
        const draft = sharedPayload || loadDraft(dateKey);

        // Убираем из выбора ТС, которых уже нет в парке (repair/conservation/sold)
        const availableIds = new Set(rows.map((r) => String(r.id)));
        if (draft?.selectedMixerIds?.length) {
          const pruned = draft.selectedMixerIds.filter((id) => availableIds.has(String(id)));
          setSelectedIds(
            new Set(
              pruned.length
                ? pruned.map(String)
                : rows.filter((r) => r.type === 'own').map((r) => String(r.id)),
            ),
          );
        } else {
          setSelectedIds(
            new Set(rows.filter((r) => r.type === 'own').map((r) => String(r.id))),
          );
        }
        setLockedTrips(uniquifyPlannedTripIds(onlyToday(draft?.lockedTrips)));
        setTrips(uniquifyPlannedTripIds(onlyToday(draft?.trips)));
        setWarnings(
          Array.isArray(draft?.warnings)
            ? (draft!.warnings as PlannerWarning[])
            : [],
        );
        if (draft?.manualDoneOrderIds) {
          setManualDone(
            new Set(
              draft.manualDoneOrderIds.filter((id) => dayOrderIds.has(String(id))),
            ),
          );
        } else {
          setManualDone(new Set());
        }
        setAllowNight(Boolean(draft?.allowNight));
        setUseTraffic(Boolean(draft?.useTraffic));
        setUseLiveGps(Boolean(draft?.useLiveGps));
        setOrderShifts(Array.isArray(draft?.orderShifts) ? draft.orderShifts : []);
        setWaves(Array.isArray(draft?.waves) ? draft.waves : []);
        const volOv = parseMixerVolumeOverrides(draft?.mixerVolumeOverrides) || {};
        setMixerVolumeOverrides(volOv);
        mixerVolumeOverridesRef.current = volOv;
        setActiveWaveId(null);
        setScenarios([]);
        setActiveScenarioId(null);
        setFleetGrowNote('');

        if (shared) {
          migrateLocalToSharedRef.current = false;
          localRevisionRef.current = Number(shared.revision) || 0;
          setPublishDirty(false);
          setStaleConflict(null);
          setSharedMeta({
            revision: Number(shared.revision) || 0,
            updatedAt: shared.updated_at || null,
            updatedByName: shared.updated_by_name || null,
            editingByName: shared.editing_by_name || null,
            editingByUserId: shared.editing_by_user_id ?? null,
            editingAt: shared.editing_at || null,
          });
          if (sharedPayload) {
            saveDraft(dateKey, {
              selectedMixerIds: sharedPayload.selectedMixerIds,
              lockedTrips: onlyToday(sharedPayload.lockedTrips),
              manualDoneOrderIds: sharedPayload.manualDoneOrderIds,
              trips: onlyToday(sharedPayload.trips),
              allowNight: sharedPayload.allowNight,
              useTraffic: sharedPayload.useTraffic,
              useLiveGps: sharedPayload.useLiveGps,
              orderShifts: sharedPayload.orderShifts,
              warnings: sharedPayload.warnings,
              waves: sharedPayload.waves,
              mixerVolumeOverrides: sharedPayload.mixerVolumeOverrides,
            });
          }
        } else {
          localRevisionRef.current = 0;
          setSharedMeta(null);
          // Расчёт был до Фазы 6 — только в localStorage. Поднимем в общий план.
          migrateLocalToSharedRef.current = onlyToday(draft?.trips).length > 0;
        }
      } catch {
        if (!cancelled) setFleet([]);
      } finally {
        if (!cancelled) {
          setLoadingFleet(false);
          // Дать React применить hydrate, затем разрешить публикацию.
          setTimeout(() => {
            if (!cancelled) suppressPublishRef.current = false;
          }, 50);
        }
      }
    })();
    return () => {
      cancelled = true;
      suppressPublishRef.current = true;
    };
    // orders читаем на смене дня (вместе с dateKey); не вешаем на каждый refresh списка
  }, [dateKey]);

  // Если в черновике остались рейсы не из текущего дня — вычищаем.
  // Пока заявки ещё не подгрузились — не трогаем (иначе на странице планирования
  // hydrate успевает записать план, а пустой orders вычищает все рейсы).
  useEffect(() => {
    if (!orders.length) return;
    const dayOrderIds = new Set(orders.map((o) => String(o.id)));
    setTrips((prev) => {
      const filtered = prev.filter((t) => dayOrderIds.has(String(t.orderId)));
      if (filtered.length !== prev.length) {
        return uniquifyPlannedTripIds(filtered);
      }
      const next = uniquifyPlannedTripIds(prev);
      return next === prev ? prev : next;
    });
    setLockedTrips((prev) => {
      const filtered = prev.filter((t) => dayOrderIds.has(String(t.orderId)));
      if (filtered.length !== prev.length) {
        return uniquifyPlannedTripIds(filtered);
      }
      const next = uniquifyPlannedTripIds(prev);
      return next === prev ? prev : next;
    });
  }, [orders, dateKey]);

  // Разовая очистка «нет в заявке» у отработанных заявок дня (completed или
  // объём уже закрыт фактом — даже при status=processing). Результат придёт
  // через realtime → applyRemotePlan.
  const prunedDateRef = useRef<string>('');
  useEffect(() => {
    if (loadingFleet || !canEditPlan || isOperatorView) return;
    const apiDate = normalizePlanDateKey(toApiDateKey(dateKey)) || toApiDateKey(dateKey);
    if (!apiDate || prunedDateRef.current === apiDate) return;
    let cancelled = false;
    void fetch('/api/adminCifra/logistics-plan/prune-ghosts', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ date: apiDate }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) prunedDateRef.current = apiDate;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dateKey, loadingFleet, canEditPlan, isOperatorView]);

  const plannerMixers: PlannerMixer[] = useMemo(() => {
    return fleet
      .filter((f) => selectedIds.has(String(f.id)))
      .map((f) => {
        const st = stats[f.number] || { tripCount: 0, volumeSum: 0 };
        const ov = mixerVolumeOverrides[f.number];
        return {
          id: f.id,
          number: f.number,
          volume:
            ov != null && ov > 0
              ? Math.round(Math.min(Number(f.volume) || ov, ov) * 10) / 10
              : f.volume,
          type: f.type,
          unloadMin: f.unload_allowance_min,
          tripCount: st.tripCount,
          volumeSum: st.volumeSum,
          lifecycle_status: f.lifecycle_status ?? 'active',
        };
      });
  }, [fleet, selectedIds, stats, mixerVolumeOverrides]);

  const rankedAll = useMemo(() => {
    return rankFleetForDay(
      fleet.map((f) => {
        const st = stats[f.number] || { tripCount: 0, volumeSum: 0 };
        return {
          id: f.id,
          number: f.number,
          volume: f.volume,
          type: f.type,
          unloadMin: f.unload_allowance_min,
          tripCount: st.tripCount,
          volumeSum: st.volumeSum,
          lifecycle_status: f.lifecycle_status ?? 'active',
        };
      }),
    );
  }, [fleet, stats]);

  const fleetById = useMemo(() => {
    const map = new Map<string, FleetRow>();
    for (const f of fleet) map.set(String(f.id), f);
    return map;
  }, [fleet]);

  // Зелёный баннер: всегда от текущего выбора миксеров (клик по тегу → сразу пересчёт).
  const hintText = useMemo(() => {
    if (roadsRefreshing || loadingFleet || !rankedAll.length) {
      return 'Считаю, сколько своих и наёмных нужно под объём дня…';
    }
    if (plannerMixers.length === 0) {
      return 'Выбери миксеры в расчёт — баннер обновится под твой парк.';
    }

    const own = plannerMixers.filter((m) => m.type === 'own').length;
    const rented = plannerMixers.length - own;
    const selPart = formatOwnRented(own, rented);
    const n = plannerMixers.length;
    const selectedPhrase = withSelectedMixersPhrase(n);

    // Live-факт оператора (order_mixers, в т.ч. самовывоз «В пути»): вычитаем
    // отгруженное и сдвигаем хвост от «сейчас», чтобы старт соски не залипал в утре.
    const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
    const live = applyLiveFactToOrders(plannerOrders, dayTrips, {
      nowMinutes: nowMin,
    });
    const remainingOrders = live.orders.filter(
      (o) => !manualDone.has(String(o.id)),
    );
    const manualOnlyDone = plannerOrders.filter(
      (o) =>
        manualDone.has(String(o.id)) &&
        liveShippedVolumeForOrder(o.id, dayTrips) < (Number(o.volume) || 0) - 0.05,
    ).length;
    const doneCount = live.fullyShippedCount + manualOnlyDone;

    if (remainingOrders.length === 0) {
      return (
        `${selectedPhrase} (${selPart}) — все заявки дня уже отработаны` +
        (live.shippedTotal > 0 ? ` (уже занято ${live.shippedTotal} м³)` : '') +
        '.'
      );
    }

    // Превью на выбранном парке и остатке по факту — без автодобора «со стороны».
    const preview = planLogistics({
      mode: 'full_day',
      orders: remainingOrders,
      mixers: plannerMixers,
      allowNight,
      useTraffic,
      // Превью без live fetch — GPS только при полном расчёте
      useLiveGps: false,
    });
    const plantOpen =
      preview.plantOpenMinutes ??
      resolvePlantOpenMinutes(remainingOrders, { useTraffic });
    const usedNums = new Set(
      preview.trips
        .filter((t) => !t.pickup && t.mixerNumber !== PICKUP_MIXER_NUMBER)
        .map((t) => t.mixerNumber),
    );
    const usedCount = usedNums.size;
    const fact = fleetHintFromPlan(
      preview.trips,
      remainingOrders,
      plannerMixers,
      allowNight,
      {
        uncoveredVolume: preview.uncoveredVolume,
        useTraffic,
        plantOpenMinutes: plantOpen,
      },
    );

    const bounds = getPlanDayBounds(preview.trips);
    const factNote =
      live.shippedTotal > 0.05
        ? ` · занято −${live.shippedTotal} м³`
        : doneCount > 0
          ? ` · без ${doneCount} отработ.`
          : '';
    // Если остались только хвосты «от сейчас» / уже идёт день — не врём про утренний старт.
    const startPart =
      bounds.startLabel != null
        ? nowMin != null &&
          bounds.startMin != null &&
          bounds.startMin <= nowMin + 2
          ? ' (соска уже работает / следующий слот сейчас)'
          : ` (старт соски ~${bounds.startLabel})`
        : '';
    const timeBit =
      bounds.finishLabel != null
        ? ` — закончим к ~${bounds.finishLabel}` + startPart + factNote
        : startPart + factNote;

    if (preview.fitsWindow) {
      const usedNote =
        usedCount > 0 && usedCount < n
          ? ` В рейсах займут ${usedCount} из ${n}.`
          : ` Все ${n} могут участвовать.`;
      const tripBit =
        fact.suggestedTripCount > 0
          ? ` Превью: ${fact.suggestedTripCount} ${pluralRu(fact.suggestedTripCount, 'рейс', 'рейса', 'рейсов')}, остаток ${fact.totalVolume} м³.`
          : '';
      const savedNote =
        trips.length > 0
          ? ' В таблице — прошлый расчёт; «Рассчитать весь день», чтобы расставить рейсы.'
          : ' Нажми «Рассчитать весь день» — расставлю рейсы по заявкам.';
      return (
        `${selectedPhrase} (${selPart})${timeBit}.` +
        usedNote +
        tripBit +
        savedNote
      );
    }

    const need = estimateDayFleetNeed(remainingOrders, rankedAll, {
      allowNight,
      useTraffic,
    });
    const tail =
      preview.uncoveredVolume > 0.05
        ? ` — хвост ~${preview.uncoveredVolume.toFixed(1)} м³`
        : '';
    const partialFinish =
      bounds.finishLabel != null
        ? ` По закрытой части закончим к ~${bounds.finishLabel}` + startPart + '.'
        : '';
    return (
      `${selectedPhrase} (${selPart}) не хватает${tail}.` +
      partialFinish +
      (need.neededCount > 0
        ? ` Ориентир: нужно ~${need.neededCount} (${formatOwnRented(need.ownCount, need.rentedCount)}).`
        : '') +
      ` Добери миксеры или включи «Включая ночь».`
    );
  }, [
    dateKey,
    trips,
    dayTrips,
    manualDone,
    plannerMixers,
    plannerOrders,
    rankedAll,
    allowNight,
    useTraffic,
    roadsRefreshing,
    loadingFleet,
  ]);

  // Live: рейс плана → done по факту оператора (Разгружен / весь объём заявки ушёл с БСУ).
  // Важно: только через 1:1 матч (planFact), иначе один «Разгружен» закрывает
  // все плановые слоты того же миксера на заявке.
  useEffect(() => {
    if (!trips.length || !dayTrips.length) return;
    setTrips((prev) => {
      let changed = false;
      const orderShippedDone = new Set<string>();
      for (const o of plannerOrders) {
        const shipped = liveShippedVolumeForOrder(o.id, dayTrips);
        if (Number(o.volume) > 0 && shipped >= Number(o.volume) - 0.05) {
          orderShippedDone.add(String(o.id));
        }
      }
      const next = prev.map((t) => {
        if (t.done) return t;
        const oid = String(t.orderId);
        if (orderShippedDone.has(oid)) {
          changed = true;
          return { ...t, done: true, locked: true };
        }
        const fact = planFactByTripId.get(t.id);
        if (fact?.hasMatch && fact.factStatus === 'Разгружен') {
          changed = true;
          return { ...t, done: true, locked: true };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [dayTrips, trips.length, plannerOrders, planFactByTripId]);

  useEffect(() => {
    warningsRef.current = warnings;
  }, [warnings]);

  useEffect(() => {
    wavesRef.current = waves;
  }, [waves]);

  useEffect(() => {
    mixerVolumeOverridesRef.current = mixerVolumeOverrides;
  }, [mixerVolumeOverrides]);

  const persist = useCallback(
    (next: Partial<DraftState> & { trips?: PlannedTrip[]; lockedTrips?: PlannedTrip[] }) => {
      const draft: DraftState = {
        selectedMixerIds: [...selectedIds],
        lockedTrips: next.lockedTrips ?? lockedTrips,
        manualDoneOrderIds: [...manualDone],
        trips: next.trips ?? trips,
        allowNight: next.allowNight ?? allowNight,
        useTraffic: next.useTraffic ?? useTraffic,
        useLiveGps: next.useLiveGps ?? useLiveGps,
        orderShifts: next.orderShifts ?? orderShifts,
        warnings: next.warnings ?? warningsRef.current,
        waves: next.waves ?? wavesRef.current,
        mixerVolumeOverrides:
          next.mixerVolumeOverrides ?? mixerVolumeOverridesRef.current,
      };
      if (next.selectedMixerIds) draft.selectedMixerIds = next.selectedMixerIds;
      draftSnapshotRef.current = draft;
      saveDraft(dateKey, draft);
      return draft;
    },
    [dateKey, selectedIds, lockedTrips, manualDone, trips, allowNight, useTraffic, useLiveGps, orderShifts],
  );

  const applyRemotePlan = useCallback(
    (record: SharedLogisticsPlanRecord, opts?: { force?: boolean }) => {
      const rev = Number(record.revision) || 0;

      // Тонкий soft-lock broadcast — только «сейчас правит…», без payload
      if (record._thin && !opts?.force) {
        setSharedMeta((prev) =>
          prev
            ? {
                ...prev,
                editingByName: record.editing_by_name ?? prev.editingByName,
                editingByUserId:
                  record.editing_by_user_id ?? prev.editingByUserId ?? null,
                editingAt: record.editing_at ?? prev.editingAt,
              }
            : prev,
        );
        return;
      }

      // Обновить только heartbeat editing_*, если revision не новее
      if (rev > 0 && rev <= localRevisionRef.current && !opts?.force) {
        setSharedMeta((prev) =>
          prev
            ? {
                ...prev,
                editingByName: record.editing_by_name ?? prev.editingByName,
                editingByUserId:
                  record.editing_by_user_id ?? prev.editingByUserId ?? null,
                editingAt: record.editing_at ?? prev.editingAt,
              }
            : prev,
        );
        return;
      }

      // Удалён общий план
      if (!record.payload || rev === 0) {
        if (localRevisionRef.current === 0) return;
        if (publishDirty && !opts?.force) {
          setStaleConflict({
            revision: 0,
            updatedByName: record.updated_by_name || null,
            updatedAt: record.updated_at || null,
            record,
          });
          return;
        }
        suppressPublishRef.current = true;
        localRevisionRef.current = 0;
        setSharedMeta(null);
        setPublishDirty(false);
        setStaleConflict(null);
        setTrips([]);
        setLockedTrips([]);
        setWarnings([]);
        setManualDone(new Set());
        setOrderShifts([]);
        setWaves([]);
        wavesRef.current = [];
        setActiveWaveId(null);
        setAllowNight(false);
        setUseTraffic(false);
        setUseLiveGps(false);
        setMixerVolumeOverrides({});
        mixerVolumeOverridesRef.current = {};
        setScenarios([]);
        setActiveScenarioId(null);
        try {
          localStorage.removeItem(draftKey(dateKey));
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          suppressPublishRef.current = false;
        }, 300);
        return;
      }

      // Есть локальные неопубликованные правки — не затираем молча
      if (publishDirty && !opts?.force && rev > localRevisionRef.current) {
        setStaleConflict({
          revision: rev,
          updatedByName: record.updated_by_name || null,
          updatedAt: record.updated_at || null,
          record,
        });
        return;
      }

      const payload = parseSharedPayload(record.payload);
      if (!payload) return;

      suppressPublishRef.current = true;
      localRevisionRef.current = rev;
      setPublishDirty(false);
      setStaleConflict(null);
      setSharedMeta({
        revision: rev,
        updatedAt: record.updated_at || null,
        updatedByName: record.updated_by_name || null,
        editingByName: record.editing_by_name || null,
        editingByUserId: record.editing_by_user_id ?? null,
        editingAt: record.editing_at || null,
      });

      const dayOrderIds = new Set(orders.map((o) => String(o.id)));
      const onlyToday = (list: PlannedTrip[]) => {
        if (dayOrderIds.size === 0) return list;
        return list.filter((t) => dayOrderIds.has(String(t.orderId)));
      };

      if (payload.selectedMixerIds.length) {
        setSelectedIds(new Set(payload.selectedMixerIds));
      }
      setLockedTrips(uniquifyPlannedTripIds(onlyToday(payload.lockedTrips)));
      setTrips(uniquifyPlannedTripIds(onlyToday(payload.trips)));
      setWarnings(payload.warnings || []);
      setManualDone(
        new Set(
          payload.manualDoneOrderIds.filter((id) => dayOrderIds.has(String(id))),
        ),
      );
      setAllowNight(Boolean(payload.allowNight));
      setUseTraffic(Boolean(payload.useTraffic));
      setUseLiveGps(Boolean(payload.useLiveGps));
      setOrderShifts(payload.orderShifts || []);
      setWaves(payload.waves || []);
      wavesRef.current = payload.waves || [];
      const volOv = payload.mixerVolumeOverrides || {};
      setMixerVolumeOverrides(volOv);
      mixerVolumeOverridesRef.current = volOv;
      saveDraft(dateKey, {
        ...payload,
        lockedTrips: onlyToday(payload.lockedTrips),
        trips: onlyToday(payload.trips),
        waves: payload.waves || [],
        mixerVolumeOverrides: volOv,
      });
      setTimeout(() => {
        suppressPublishRef.current = false;
      }, 300);
    },
    [dateKey, orders, publishDirty],
  );

  const publishSharedPlan = useCallback(
    async (opts?: {
      maxText?: string;
      draft?: DraftState;
      /** true — без expectedRevision (первая миграция / force) */
      force?: boolean;
      /** V2: зафиксировать утренний снимок */
      captureMorning?: boolean;
    }): Promise<boolean> => {
      if (!canMutatePlan) return false;
      const draft =
        opts?.draft ||
        draftSnapshotRef.current ||
        ({
          selectedMixerIds: [...selectedIds],
          lockedTrips,
          manualDoneOrderIds: [...manualDone],
          trips,
          allowNight,
          useTraffic,
          useLiveGps,
          orderShifts,
          warnings: warningsRef.current,
          waves: wavesRef.current,
          mixerVolumeOverrides: mixerVolumeOverridesRef.current,
        } satisfies DraftState);
      const apiDate = normalizePlanDateKey(toApiDateKey(dateKey)) || toApiDateKey(dateKey);
      setPublishing(true);
      try {
        const body: Record<string, unknown> = {
          date: apiDate,
          payload: payloadFromDraft(draft, draft.warnings || warningsRef.current),
        };
        if (opts?.maxText !== undefined) body.maxText = opts.maxText;
        if (opts?.captureMorning) body.captureMorning = true;
        if (!opts?.force && localRevisionRef.current > 0) {
          body.expectedRevision = localRevisionRef.current;
        }
        const res = await fetch('/api/adminCifra/logistics-plan', {
          method: 'PUT',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          const plan = data?.plan as DailyLogisticsPlanRow | undefined;
          setStaleConflict({
            revision: Number(plan?.revision) || 0,
            updatedByName: plan?.updated_by_name || data?.plan?.updated_by_name || null,
            updatedAt: plan?.updated_at || null,
            record: (plan || data?.plan || {}) as SharedLogisticsPlanRecord,
          });
          await appAlert(
            data.error ||
              'План устарел — кто-то уже опубликовал другую версию. Подтяни их план или перезапиши.',
            { title: 'Конфликт версий', variant: 'warning' },
          );
          return false;
        }
        if (!res.ok) {
          await appAlert(data.error || 'Не удалось опубликовать план', {
            title: 'Ошибка',
            variant: 'danger',
          });
          return false;
        }
        const plan = data?.plan as DailyLogisticsPlanRow | undefined;
        if (plan) {
          localRevisionRef.current = Number(plan.revision) || localRevisionRef.current;
          setPublishDirty(false);
          setStaleConflict(null);
          setSharedMeta({
            revision: Number(plan.revision) || 0,
            updatedAt: plan.updated_at || null,
            updatedByName: plan.updated_by_name || null,
            editingByName: plan.editing_by_name || null,
            editingByUserId: plan.editing_by_user_id ?? null,
            editingAt: plan.editing_at || null,
          });
        }
        return true;
      } catch {
        await appAlert('Сеть недоступна — план остался только локально', {
          title: 'Офлайн',
          variant: 'warning',
        });
        return false;
      } finally {
        setPublishing(false);
      }
    },
    [
      canEditPlan,
      dateKey,
      selectedIds,
      lockedTrips,
      manualDone,
      trips,
      allowNight,
      useTraffic,
      useLiveGps,
      orderShifts,
    ],
  );

  /** Явная публикация (кнопка). Расчёт/этап тоже публикуют сразу. */
  const schedulePublish = useCallback(
    (opts?: {
      maxText?: string;
      draft?: DraftState;
      immediate?: boolean;
      captureMorning?: boolean;
      force?: boolean;
    }) => {
      if (!canEditPlan || suppressPublishRef.current) return;
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
      const run = () => {
        publishTimerRef.current = null;
        void publishSharedPlan(opts);
      };
      if (opts?.immediate) run();
      else publishTimerRef.current = setTimeout(run, 200);
    },
    [canEditPlan, publishSharedPlan],
  );

  // Live-синк матча: orderMixerId + номер миксера + время загрузки из заявки.
  // Иначе план показывает P330AX, а у оператора на том же слоте уже O264HP «Загрузка».
  useEffect(() => {
    if (
      stickySyncRef.current ||
      !trips.length ||
      isOperatorView ||
      !canMutatePlan
    ) {
      return;
    }
    let changed = false;
    const next = trips.map((t) => {
      const fact = planFactByTripId.get(t.id);
      if (!fact?.hasMatch || fact.matchedTripId == null) return t;
      let updated = t;
      if (t.orderMixerId !== fact.matchedTripId) {
        changed = true;
        updated = { ...updated, orderMixerId: fact.matchedTripId };
      }
      if (
        fact.factMixerNumber &&
        !mixerPlatesEqual(updated.mixerNumber, fact.factMixerNumber)
      ) {
        const fleetHit = fleet.find((f) =>
          mixerPlatesEqual(f.number, fact.factMixerNumber),
        );
        changed = true;
        updated = {
          ...updated,
          mixerNumber: fact.factMixerNumber,
          mixerId: fleetHit?.id ?? updated.mixerId,
        };
      }
      if (
        !updated.done &&
        fact.factStatus !== 'Разгружен' &&
        fact.factPlanTime
      ) {
        const factMin = parsePlanHhMm(fact.factPlanTime);
        const planMin =
          updated.loadAtMin ?? parsePlanHhMm(String(updated.loadTime));
        if (
          factMin != null &&
          (planMin == null || Math.abs(factMin - planMin) >= 1)
        ) {
          changed = true;
          updated = applyManualLoadShiftToTrip(updated, factMin);
        }
      }
      return updated;
    });
    if (!changed) return;
    stickySyncRef.current = true;
    suppressPublishRef.current = true;
    const nextLocked = lockedTrips.map((t) => {
      const hit = next.find((x) => x.id === t.id);
      return hit ? { ...hit, locked: true } : t;
    });
    setTrips(next);
    setLockedTrips(nextLocked);
    persist({ trips: next, lockedTrips: nextLocked });
    queueMicrotask(() => {
      stickySyncRef.current = false;
      suppressPublishRef.current = false;
      setPublishDirty(true);
    });
  }, [
    planFactByTripId,
    trips,
    lockedTrips,
    fleet,
    isOperatorView,
    canMutatePlan,
    persist,
  ]);

  useEffect(() => {
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
      if (autoStageTimerRef.current) clearTimeout(autoStageTimerRef.current);
      if (autoLoadingStageTimerRef.current) {
        clearTimeout(autoLoadingStageTimerRef.current);
      }
    };
  }, []);

  // Локальный черновик + dirty; авто-PUT убран — нужна кнопка «Опубликовать».
  useEffect(() => {
    if (loadingFleet) return;
    const draft = persist({});
    if (migrateLocalToSharedRef.current && draft.trips.length > 0) {
      migrateLocalToSharedRef.current = false;
      const toPublish = draft;
      window.setTimeout(() => {
        suppressPublishRef.current = false;
        void publishSharedPlan({ draft: toPublish, force: true });
      }, 120);
      return;
    }
    if (suppressPublishRef.current) return;
    setPublishDirty(true);
  }, [
    selectedIds,
    trips,
    lockedTrips,
    manualDone,
    allowNight,
    useTraffic,
    useLiveGps,
    orderShifts,
    waves,
    warnings,
    loadingFleet,
    persist,
    publishSharedPlan,
  ]);

  applyRemoteRef.current = applyRemotePlan;

  useRealtimeDailyLogisticsPlan(
    dateKey,
    (record) => applyRemoteRef.current(record),
    { enabled: !loadingFleet },
  );

  const toggleMixer = (id: string) => {
    if (!canMutatePlan) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFleetGrowNote(''); // устаревшая подсказка после прошлого «Рассчитать»
  };

  const selectOwn = () => {
    if (!canMutatePlan) return;
    setSelectedIds(new Set(fleet.filter((f) => f.type === 'own').map((f) => String(f.id))));
    setFleetGrowNote('');
  };

  const selectAll = () => {
    if (!canMutatePlan) return;
    setSelectedIds(new Set(fleet.map((f) => String(f.id))));
    setFleetGrowNote('');
  };

  const commitWavePlan = (
    mode: 'full_day' | 'stage' | 'shift',
    nextTrips: PlannedTrip[],
    nextLocked: PlannedTrip[],
    nextWarnings: PlannerWarning[],
    opts?: {
      newTripIds?: string[];
      delayFactMin?: number;
      summary?: string;
      orderShifts?: PlannerOrderShift[];
    },
  ) => {
    const index =
      mode === 'full_day' ? 0 : mode === 'stage' ? nextWaveStageIndex(wavesRef.current) : wavesRef.current.length;
    const newIds =
      opts?.newTripIds ||
      (mode === 'full_day'
        ? nextTrips.map((t) => t.id)
        : nextTrips.filter((t) => !nextLocked.some((l) => l.id === t.id)).map((t) => t.id));
    const calibMeta = toCalibrationSourceMeta(calibrationRef.current || calibration);
    const wave = makePlannerWave({
      index: mode === 'shift' ? Math.max(0, nextWaveStageIndex(wavesRef.current) - 1) : index,
      mode,
      trips: nextTrips,
      newTripIds: newIds,
      delayFactMin: opts?.delayFactMin,
      createdByName: actorDisplayName(),
      summary: opts?.summary,
      calibrationSource: {
        days: calibMeta.days,
        samples: calibMeta.samples,
        loadP50: calibMeta.loadP50,
        unloadP50: calibMeta.unloadP50,
        active: calibMeta.active,
      },
    });
    const stamped = uniquifyPlannedTripIds(
      nextTrips.map((t) =>
        newIds.includes(t.id) ? { ...t, waveId: wave.id } : t,
      ),
    );
    const nextWaves =
      mode === 'full_day' ? [wave] : [...wavesRef.current, wave];
    setWaves(nextWaves);
    wavesRef.current = nextWaves;
    setActiveWaveId(wave.id);
    setWarnings(nextWarnings);
    setLockedTrips(nextLocked);
    setTrips(stamped);
    if (opts?.orderShifts) setOrderShifts(opts.orderShifts);
    if (opts?.delayFactMin && opts.delayFactMin > 0) {
      lastAutoStageDelayRef.current = Math.max(
        lastAutoStageDelayRef.current,
        opts.delayFactMin,
      );
    }
    suppressPublishRef.current = true;
    persist({
      trips: stamped,
      lockedTrips: nextLocked,
      waves: nextWaves,
      orderShifts: opts?.orderShifts ?? orderShifts,
      warnings: nextWarnings,
    });
    // Расчёт / этап / сдвиг — сразу в общий план (явное действие).
    schedulePublish({
      draft: {
        selectedMixerIds: [...selectedIds],
        lockedTrips: nextLocked,
        manualDoneOrderIds: [...manualDone],
        trips: stamped,
        allowNight,
        useTraffic,
        useLiveGps,
        orderShifts: opts?.orderShifts ?? orderShifts,
        warnings: nextWarnings,
        waves: nextWaves,
        mixerVolumeOverrides: mixerVolumeOverridesRef.current,
      },
      immediate: true,
      captureMorning: mode === 'full_day',
    });
    setTimeout(() => {
      suppressPublishRef.current = false;
      setPublishDirty(false);
    }, 500);
  };

  const applyScenario = (sc: PlannerScenario) => {
    if (!canMutatePlan) return;
    setActiveScenarioId(sc.id);
    setSelectedIds(new Set(sc.mixerIds));
    const was = plannerMixers.length;
    const needed = sc.mixerCount || sc.mixerIds.length;
    const added = sc.mixers.filter(
      (m) => !plannerMixers.some((p) => String(p.id) === String(m.id)),
    );
    const own = sc.mixers.filter((m) => m.type === 'own').length;
    const rented = sc.mixers.length - own;
    setFleetGrowNote(
      formatFleetGrowAdvice({
        initialCount: was,
        neededCount: needed,
        added,
        fits: sc.fitsWindow,
        uncoveredVolume: sc.uncoveredVolume,
        ownCount: own,
        rentedCount: rented,
      }),
    );
    const mode: 'full_day' | 'stage' = wavesRef.current.some(
      (w) => w.mode === 'full_day',
    )
      ? 'stage'
      : 'full_day';
    commitWavePlan(mode, sc.trips, mode === 'full_day' ? [] : lockedTrips, sc.warnings, {
      summary: `вариант ${sc.id}`,
      orderShifts: sc.orderShifts,
    });
  };

  /** Подтянуть online GPS для опции «Учесть GPS». */
  const loadLiveGpsForPlan = async (
    ordersForSites: PlannerOrder[] = plannerOrders,
  ): Promise<{
    mixerGps?: Record<string, PlannerMixerGps>;
    siteCoordsByOrderId?: Record<string, { lat: number; lon: number }>;
  }> => {
    if (!useLiveGps) return {};
    let mixerGps: Record<string, PlannerMixerGps> = {};
    try {
      const telRes = await fetch('/api/adminCifra/fleet/telemetry', {
        headers: adminCifraAuthHeaders(),
        cache: 'no-store',
      });
      const telData = await telRes.json().catch(() => ({}));
      if (telRes.ok && telData.success && Array.isArray(telData.telemetry)) {
        mixerGps = mixerGpsFromTelemetry(telData.telemetry as FleetTelemetrySnapshot[]);
      }
    } catch {
      /* пустая карта — движок покажет info-warning */
    }
    return {
      mixerGps,
      siteCoordsByOrderId: siteCoordsFromOrders(ordersForSites),
    };
  };

  const runPlan = async (
    mode: 'full_day' | 'stage',
    opts?: { silent?: boolean },
  ) => {
    if (!canMutatePlan) return;
    const silent = Boolean(opts?.silent);
    setBusy(true);
    try {
      if (
        mode === 'full_day' &&
        (lockedTrips.length > 0 || trips.some((t) => t.locked || t.done))
      ) {
        if (silent) return;
        const ok = await appConfirm(
          'Пересчитать весь день? Зафиксированные и отработанные рейсы будут сброшены. История волн начнётся заново с «План дня».',
          { title: 'Весь день', okLabel: 'Пересчитать', variant: 'danger' },
        );
        if (!ok) return;
      }

      const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
      const live = applyLiveFactToOrders(plannerOrders, dayTrips, {
        nowMinutes: nowMin,
      });
      const ordersForPlan = live.orders.filter(
        (o) => !manualDone.has(String(o.id)),
      );
      const doneOrderIds = plannerOrders
        .filter((o) => {
          if (manualDone.has(String(o.id))) return true;
          return orderProgressStatus(o, dayTrips, trips, false) === 'done';
        })
        .map((o) => o.id);

      // Фаза 4: медиана опоздания факта → сдвиг целей хвоста на этапе.
      const delayFactMin =
        mode === 'stage'
          ? medianFactDelayMin(
              [...planFactByTripId.values()].map(
                (f) => f.deltaLoadMin ?? f.deltaReleaseMin,
              ),
            )
          : 0;

      // Этап: якорим done + live (Загрузка / уехавшие).
      // Фантомы «нет в заявке» с фиксом НЕ якорим, если в заявке уже есть live —
      // иначе они навсегда висят над реальной очередью (11:46 выше «Загрузка»).
      let locked: PlannedTrip[] = [];
      if (mode === 'stage') {
        const liveActiveOrderIds = new Set<string>();
        for (const t of trips) {
          if (t.done) continue;
          const fact = planFactByTripId.get(t.id);
          const st = String(fact?.factStatus || '');
          const live =
            Boolean(fact?.matchedTripId) &&
            (st === 'Загрузка' ||
              st === 'Проблема' ||
              Boolean(fact?.factRelease) ||
              (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st));
          if (live) liveActiveOrderIds.add(String(t.orderId));
        }

        const shouldAnchor = (t: PlannedTrip): boolean => {
          if (t.done) return true;
          const fact = planFactByTripId.get(t.id);
          if (fact?.factRelease || fact?.noOperatorRecord) return true;
          const st = String(fact?.factStatus || '');
          const isLive =
            Boolean(fact?.matchedTripId) &&
            (st === 'Загрузка' ||
              st === 'Проблема' ||
              (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(st));
          if (isLive) return true;

          // Явный фикс (замок / «Зафиксировать»): держим якорем.
          // Фантом отпускаем только если: нет факта + в заявке уже live +
          // плановая загрузка уже в прошлом (просроченный слот «над» Загрузкой).
          if (t.locked) {
            if (String(t.id).startsWith('live-orphan-')) return false;
            const phantomNoMatch =
              liveActiveOrderIds.has(String(t.orderId)) && !fact?.hasMatch;
            if (phantomNoMatch) {
              const loadMin =
                t.loadAtMin ?? parsePlanHhMm(String(t.loadTime));
              if (
                nowMin != null &&
                loadMin != null &&
                loadMin < nowMin - 10
              ) {
                return false;
              }
            }
            return true;
          }

          return dayTrips.some(
            (d) =>
              String(d.orderId ?? d.order_id) === String(t.orderId) &&
              liveTripHasReleaseFact(d, dayProductionLogs) &&
              (t.pickup ||
                t.mixerNumber === PICKUP_MIXER_NUMBER ||
                String(d.number || d.mixer_name || '') === t.mixerNumber),
          );
        };

        const factLocked = trips.filter(shouldAnchor).map((t) => {
          const fact = planFactByTripId.get(t.id);
          return {
            ...t,
            locked: true,
            done: t.done || Boolean(fact?.factRelease),
            orderMixerId: t.orderMixerId ?? fact?.matchedTripId ?? null,
          };
        });
        // lockedTrips из state тоже чистим от фантомов, если в заявке уже live
        const lockedFromState = lockedTrips
          .filter((t) => shouldAnchor(t))
          .map((t) => ({ ...t, locked: true }));
        locked = [...lockedFromState, ...factLocked].filter(
          (t, i, arr) => arr.findIndex((x) => x.id === t.id) === i,
        );
      }

      // Пустой остаток ≠ «считай заново весь день»: иначе done/manualDone сбрасываются.
      if (ordersForPlan.length === 0) {
        // Автоэтап/автосдвиг не долбят модалкой, когда день уже закрыт.
        if (!silent) {
          await appAlert(
            'Нет заявок для расчёта — все уже отработаны или закрыты по факту.',
            { title: 'Расчёт', variant: 'warning' },
          );
        } else {
          setAutoStageNote('');
        }
        return;
      }

      const gpsOpts = await loadLiveGpsForPlan(ordersForPlan);

      const baseInput = {
        mode,
        orders: ordersForPlan,
        mixers: plannerMixers,
        lockedTrips: locked,
        doneOrderIds,
        allowNight,
        useTraffic,
        useLiveGps,
        ...gpsOpts,
        factDelayMin: delayFactMin || undefined,
        // Этап: новые соски не раньше «сейчас». Для GPS — и full_day сегодня.
        nowMinutes:
          mode === 'stage' || (useLiveGps && nowMin != null) ? nowMin : undefined,
        calibration: calibrationRef.current || calibration,
      };

      const grown = ensureFleetForWindow(baseInput, rankedAll);

      if (grown.result.fitsWindow) {
        setSelectedIds(new Set(grown.mixers.map((m) => String(m.id))));
        setFleetGrowNote(grown.advice);
        setScenarios([]);
        setActiveScenarioId(null);
        setOrderShifts([]);
        commitWavePlan(
          mode,
          grown.result.trips,
          mode === 'full_day' ? [] : locked,
          grown.result.warnings,
          {
            newTripIds: grown.result.newTrips.map((t) => t.id),
            delayFactMin: delayFactMin || undefined,
            summary:
              delayFactMin > 0
                ? `учтено опоздание +${delayFactMin} мин`
                : undefined,
            orderShifts: [],
          },
        );
        return;
      }

      const variants = buildPlannerScenarios(baseInput, rankedAll);
      setScenarios(variants);
      const pick =
        variants.find((v) => v.id === 'A' && v.fitsWindow) ||
        variants.find((v) => v.id === 'B' && v.fitsWindow) ||
        variants.find((v) => v.id === 'A') ||
        variants[0];
      if (pick) {
        setSelectedIds(new Set(pick.mixerIds.map(String)));
        setActiveScenarioId(pick.id);
        setFleetGrowNote('');
        commitWavePlan(
          mode,
          pick.trips,
          mode === 'full_day' ? [] : locked,
          pick.warnings,
          {
            newTripIds: pick.trips
              .filter((t) => !(t.locked || t.done))
              .map((t) => t.id),
            delayFactMin: delayFactMin || undefined,
            summary:
              `вариант ${pick.id}` +
              (delayFactMin > 0 ? ` · опоздание +${delayFactMin} мин` : ''),
            orderShifts: pick.orderShifts,
          },
        );
      }
    } finally {
      setBusy(false);
    }
  };
  runPlanRef.current = runPlan;

  const shiftTripLoad = async (tripId: string, loadHhMm: string) => {
    if (!canMutatePlan) return;
    const newLoad = parsePlanHhMm(loadHhMm);
    if (newLoad == null) {
      await appAlert('Время в формате ЧЧ:ММ', { title: 'Сдвиг рейса', variant: 'danger' });
      return;
    }
    const target = trips.find((t) => t.id === tripId);
    if (!target) return;
    const ok = await appConfirm(
      `Сдвинуть загрузку ${target.mixerNumber} на ${loadHhMm}? Рейсы раньше этого времени зафиксируются, хвост пересчитается.`,
      { title: 'Сдвиг рейса', okLabel: 'Пересчитать хвост', variant: 'warning' },
    );
    if (!ok) return;

    setBusy(true);
    try {
      const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
      const delayFactMin = medianFactDelayMin(
        [...planFactByTripId.values()].map((f) => f.deltaLoadMin ?? f.deltaReleaseMin),
      );
      const doneOrderIds = plannerOrders
        .filter((o) => {
          if (manualDone.has(String(o.id))) return true;
          return orderProgressStatus(o, dayTrips, trips, false) === 'done';
        })
        .map((o) => o.id);

      const gpsOpts = await loadLiveGpsForPlan();
      const { result, locked, shifted } = replanAfterManualTripShift({
        allTrips: trips,
        tripId,
        newLoadAtMin: newLoad,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: plannerMixers,
        doneOrderIds,
        allowNight,
        useTraffic,
        useLiveGps,
        ...gpsOpts,
        factDelayMin: delayFactMin || undefined,
        dayTrips,
        nowMinutes: nowMin,
        calibration: calibrationRef.current || calibration,
      });
      if (!shifted) {
        await appAlert('Рейс не найден в плане', { title: 'Сдвиг', variant: 'danger' });
        return;
      }
      setScenarios([]);
      setActiveScenarioId(null);
      commitWavePlan('shift', result.trips, locked, result.warnings, {
        newTripIds: [shifted.id, ...result.newTrips.map((t) => t.id)],
        delayFactMin: delayFactMin || undefined,
        summary: `${target.mixerNumber} → загр. ${loadHhMm}`,
      });
    } finally {
      setBusy(false);
    }
  };

  /** Диспетчер: +N мин на разгрузке (звонок водителя) → пересчёт хвоста. */
  const applyTripDelay = async (tripId: string, delayMin: number) => {
    if (!canMutatePlan) return;
    const target = trips.find((t) => t.id === tripId);
    if (!target) return;
    const prev = Math.max(0, Math.round(Number(target.delayMin) || 0));
    const next = Math.max(0, Math.min(240, Math.round(delayMin)));
    if (next === prev) return;

    const ok = await appConfirm(
      next > 0
        ? `Поставить задержку ${next} мин на рейс ${target.mixerNumber}?\n\nРазгрузка и возврат удлинятся, следующие рейсы этого миксера и хвост дня пересчитаются.`
        : `Снять задержку с рейса ${target.mixerNumber}? Хвост пересчитается.`,
      {
        title: 'Задержка на рейсе',
        okLabel: next > 0 ? 'Поставить и пересчитать' : 'Снять',
        variant: 'warning',
      },
    );
    if (!ok) return;

    setBusy(true);
    try {
      const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
      const delayFactMin = medianFactDelayMin(
        [...planFactByTripId.values()].map((f) => f.deltaLoadMin ?? f.deltaReleaseMin),
      );
      const doneOrderIds = plannerOrders
        .filter((o) => {
          if (manualDone.has(String(o.id))) return true;
          return orderProgressStatus(o, dayTrips, trips, false) === 'done';
        })
        .map((o) => o.id);

      const gpsOpts = await loadLiveGpsForPlan();
      const { result, locked, shifted } = replanAfterTripDelay({
        allTrips: trips,
        tripId,
        delayMin: next,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: plannerMixers,
        doneOrderIds,
        allowNight,
        useTraffic,
        useLiveGps,
        ...gpsOpts,
        factDelayMin: delayFactMin || undefined,
        dayTrips,
        nowMinutes: nowMin,
        calibration: calibrationRef.current || calibration,
      });
      if (!shifted) {
        await appAlert('Рейс не найден в плане', {
          title: 'Задержка',
          variant: 'danger',
        });
        return;
      }
      setScenarios([]);
      setActiveScenarioId(null);
      commitWavePlan('shift', result.trips, locked, result.warnings, {
        newTripIds: [shifted.id, ...result.newTrips.map((t) => t.id)],
        summary:
          next > 0
            ? `${target.mixerNumber} · задержка +${next} мин`
            : `${target.mixerNumber} · задержку сняли`,
      });
    } finally {
      setBusy(false);
    }
  };

  /** Правка планового объёма рейса (бочка забита и т.п.) → вместимость миксера + хвост. */
  const applyTripPlanVolume = async (tripId: string, volume: number) => {
    if (!canMutatePlan) return;
    const target = trips.find((t) => t.id === tripId);
    if (!target) return;
    const nextVol = Math.round(Math.max(0.1, Math.min(20, Number(volume) || 0)) * 10) / 10;
    const prevVol = Number(target.volume) || 0;
    if (Math.abs(nextVol - prevVol) < 0.05) return;

    const ok = await appConfirm(
      `Изменить объём рейса ${target.mixerNumber} с ${prevVol} на ${nextVol} м³?\n\nПересчитаются план и хвост дня. В заявку объём уйдёт только после «Применить в заявки». Если потом диспетчер поправит объём в заявке вручную — план снова подтянет его.`,
      {
        title: 'Объём в плане',
        okLabel: 'Пересчитать',
        variant: 'warning',
      },
    );
    if (!ok) return;

    const nextOverrides = {
      ...mixerVolumeOverridesRef.current,
      [String(target.mixerNumber)]: nextVol,
    };
    setMixerVolumeOverrides(nextOverrides);
    mixerVolumeOverridesRef.current = nextOverrides;

    const mixersForPlan = plannerMixers.map((m) =>
      String(m.number) === String(target.mixerNumber)
        ? { ...m, volume: nextVol }
        : m,
    );

    setBusy(true);
    try {
      const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
      const delayFactMin = medianFactDelayMin(
        [...planFactByTripId.values()].map((f) => f.deltaLoadMin ?? f.deltaReleaseMin),
      );
      const doneOrderIds = plannerOrders
        .filter((o) => {
          if (manualDone.has(String(o.id))) return true;
          return orderProgressStatus(o, dayTrips, trips, false) === 'done';
        })
        .map((o) => o.id);

      const gpsOpts = await loadLiveGpsForPlan();
      const { result, locked, shifted } = replanAfterTripVolumeChange({
        allTrips: trips,
        tripId,
        volume: nextVol,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: mixersForPlan,
        doneOrderIds,
        allowNight,
        useTraffic,
        useLiveGps,
        ...gpsOpts,
        factDelayMin: delayFactMin || undefined,
        dayTrips,
        nowMinutes: nowMin,
        calibration: calibrationRef.current || calibration,
      });
      if (!shifted) {
        await appAlert('Рейс не найден в плане', {
          title: 'Объём',
          variant: 'danger',
        });
        return;
      }
      setScenarios([]);
      setActiveScenarioId(null);
      persist({ mixerVolumeOverrides: nextOverrides });
      commitWavePlan('shift', result.trips, locked, result.warnings, {
        newTripIds: [shifted.id, ...result.newTrips.map((t) => t.id)],
        summary: `${target.mixerNumber} · объём ${prevVol}→${nextVol} м³`,
      });
    } finally {
      setBusy(false);
    }
  };

  /** Перетаскивание рейса внутри заявки или в другую заявку. */
  const reorderTrip = async (
    tripId: string,
    targetOrderId: string,
    /** Drop на рейс: в той же заявке = встать ПОСЛЕ него; в другой = перед ним. null = в конец заявки */
    dropOnTripId: string | null,
  ) => {
    if (!canMutatePlan) return;
    const target = trips.find((t) => t.id === tripId);
    if (!target) return;
    if (dropOnTripId && dropOnTripId === tripId) return;

    const sameOrder = String(target.orderId) === String(targetOrderId);
    let beforeTripId: string | null = dropOnTripId;

    if (sameOrder && dropOnTripId) {
      const orderTrips = trips
        .filter((t) => String(t.orderId) === String(targetOrderId))
        .sort(
          (a, b) =>
            (a.loadAtMin ?? 0) - (b.loadAtMin ?? 0) ||
            String(a.id).localeCompare(String(b.id)),
        );
      const from = orderTrips.findIndex((t) => t.id === tripId);
      const to = orderTrips.findIndex((t) => t.id === dropOnTripId);
      if (from < 0 || to < 0) return;
      // Уже сразу после цели — нечего двигать.
      if (to === from - 1) return;
      // Drop на строку = встать после неё (раньше «перед соседней» было no-op).
      beforeTripId = orderTrips[to + 1]?.id ?? null;
      if (beforeTripId === tripId) {
        beforeTripId = orderTrips[to + 2]?.id ?? null;
      }
    } else if (sameOrder && !dropOnTripId) {
      const orderTrips = trips
        .filter((t) => String(t.orderId) === String(targetOrderId))
        .sort(
          (a, b) =>
            (a.loadAtMin ?? 0) - (b.loadAtMin ?? 0) ||
            String(a.id).localeCompare(String(b.id)),
        );
      if (orderTrips.length && orderTrips[orderTrips.length - 1]?.id === tripId) {
        return;
      }
    }

    const orderLabel =
      plannerOrders.find((o) => String(o.id) === String(targetOrderId))?.client ||
      `#${targetOrderId}`;

    setBusy(true);
    try {
      const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
      const delayFactMin = medianFactDelayMin(
        [...planFactByTripId.values()].map((f) => f.deltaLoadMin ?? f.deltaReleaseMin),
      );
      const doneOrderIds = plannerOrders
        .filter((o) => {
          if (manualDone.has(String(o.id))) return true;
          return orderProgressStatus(o, dayTrips, trips, false) === 'done';
        })
        .map((o) => o.id);

      const gpsOpts = await loadLiveGpsForPlan();
      const { result, locked, shifted } = replanAfterTripReorder({
        allTrips: trips,
        tripId,
        targetOrderId,
        beforeTripId,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: plannerMixers,
        doneOrderIds,
        allowNight,
        useTraffic,
        useLiveGps,
        ...gpsOpts,
        factDelayMin: delayFactMin || undefined,
        dayTrips,
        nowMinutes: nowMin,
        calibration: calibrationRef.current || calibration,
      });
      if (!shifted) {
        await appAlert('Не удалось переместить рейс', {
          title: 'Перестановка',
          variant: 'danger',
        });
        return;
      }
      setScenarios([]);
      setActiveScenarioId(null);
      const where = dropOnTripId
        ? `после рейса в «${orderLabel}»`
        : `в конец «${orderLabel}»`;
      commitWavePlan('shift', result.trips, locked, result.warnings, {
        newTripIds: [shifted.id, ...result.newTrips.map((t) => t.id)],
        summary: `${target.mixerNumber} · ${where}`,
      });
    } finally {
      setBusy(false);
      dragTripIdRef.current = null;
      setDragTripId(null);
      setDragOverTripId(null);
      setDragOverOrderId(null);
    }
  };

  const clearTripDrag = () => {
    dragTripIdRef.current = null;
    setDragTripId(null);
    setDragOverTripId(null);
    setDragOverOrderId(null);
  };

  const lockAllCurrent = () => {
    if (!canMutatePlan) return;
    const nextTrips = trips.map((t) => ({ ...t, locked: true }));
    const map = new Map(lockedTrips.map((t) => [t.id, t]));
    for (const t of nextTrips) map.set(t.id, t);
    const nextLocked = [...map.values()];
    setTrips(nextTrips);
    setLockedTrips(nextLocked);
    persist({ trips: nextTrips, lockedTrips: nextLocked });
    schedulePublish({
      draft: {
        selectedMixerIds: [...selectedIds],
        lockedTrips: nextLocked,
        manualDoneOrderIds: [...manualDone],
        trips: nextTrips,
        allowNight,
        useTraffic,
        useLiveGps,
        orderShifts,
        warnings: warningsRef.current,
        waves: wavesRef.current,
        mixerVolumeOverrides: mixerVolumeOverridesRef.current,
      },
    });
  };

  /** Поставить / снять фикс с одного рейса (этап не трогает locked). */
  const setTripLocked = (tripId: string, locked: boolean) => {
    if (!canMutatePlan || !tripId) return;
    const nextTrips = trips.map((t) =>
      t.id === tripId ? { ...t, locked } : t,
    );
    let nextLocked: PlannedTrip[];
    if (locked) {
      const map = new Map(lockedTrips.map((t) => [t.id, t]));
      const hit = nextTrips.find((t) => t.id === tripId);
      if (hit) map.set(tripId, { ...hit, locked: true });
      nextLocked = [...map.values()];
    } else {
      nextLocked = lockedTrips.filter((t) => t.id !== tripId);
    }
    setTrips(nextTrips);
    setLockedTrips(nextLocked);
    persist({ trips: nextTrips, lockedTrips: nextLocked });
    schedulePublish({
      draft: {
        selectedMixerIds: [...selectedIds],
        lockedTrips: nextLocked,
        manualDoneOrderIds: [...manualDone],
        trips: nextTrips,
        allowNight,
        useTraffic,
        useLiveGps,
        orderShifts,
        warnings: warningsRef.current,
        waves: wavesRef.current,
        mixerVolumeOverrides: mixerVolumeOverridesRef.current,
      },
    });
  };

  const toggleOrderDone = (orderId: string) => {
    if (!canMutatePlan) return;
    const order = plannerOrders.find((o) => String(o.id) === String(orderId));
    const dbSt = String(order?.status || '').toLowerCase();
    // Выполнена / отменена — финальные статусы заявки, не «ручная отработана».
    if (dbSt === 'completed' || dbSt === 'cancelled') return;
    setManualDone((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const buildMaxBlock = (opts: {
    onlyNew?: boolean;
    /** false = полный день со всеми заявками; true = без выполненных + сводка. */
    excludeCompleted?: boolean;
  } = {}) => {
    const onlyNew = Boolean(opts.onlyNew);
    const excludeCompleted = Boolean(opts.excludeCompleted);
    const completedOrderIds = new Set<string>();
    for (const o of plannerOrders) {
      const oid = String(o.id);
      if (
        orderProgressStatus(o, dayTrips, trips, manualDone.has(oid)) === 'done'
      ) {
        completedOrderIds.add(oid);
      }
    }
    for (const g of reportGroups) {
      if (String(g.orderStatus || '').toLowerCase() === 'completed') {
        completedOrderIds.add(String(g.orderId));
      }
    }

    let blockTrips = onlyNew
      ? trips.filter((t) => !t.locked && !t.done)
      : trips;
    if (excludeCompleted) {
      blockTrips = blockTrips.filter(
        (t) => !completedOrderIds.has(String(t.orderId)),
      );
    }
    const hintOrders = excludeCompleted
      ? plannerOrders.filter((o) => !completedOrderIds.has(String(o.id)))
      : plannerOrders;
    const plantOpen = resolvePlantOpenMinutes(plannerOrders, { useTraffic });
    const hint =
      blockTrips.length > 0
        ? fleetHintFromPlan(
            blockTrips,
            hintOrders,
            plannerMixers.length ? plannerMixers : rankedAll,
            allowNight,
            { useTraffic, plantOpenMinutes: plantOpen },
          )
        : buildFleetHint(
            hintOrders,
            plannerMixers.length ? plannerMixers : rankedAll,
            undefined,
            allowNight,
            { useTraffic, plantOpenMinutes: plantOpen },
          );
    const onlyIds = onlyNew
      ? new Set(blockTrips.map((t) => String(t.orderId)))
      : undefined;
    const common = {
      plannedTrips: blockTrips.map((t) => {
        const fact = planFactByTripId.get(t.id);
        return {
          orderId: t.orderId,
          mixerNumber: t.mixerNumber,
          volume: t.volume,
          loadTime: t.loadTime,
          arriveTime: t.arriveTime,
          returnTime: t.returnTime,
          pickup: Boolean(t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER),
          factStatus: fact?.factStatus ?? null,
          factLoadStart: fact?.factLoadStart ?? null,
          factRelease: fact?.factRelease ?? null,
          factVolume: fact?.factVolume ?? null,
          deltaLoadMin: fact?.deltaLoadMin ?? null,
          deltaReleaseMin: fact?.deltaReleaseMin ?? null,
          noOperatorRecord: Boolean(fact?.noOperatorRecord),
        };
      }),
      fleetHintText: hint.text,
      warnings,
      onLineCount,
      onlyPlannedOrderIds: onlyIds,
      excludeCompleted,
      completedOrderIds,
      allowNight,
      useTraffic,
      plantOpenMinutes: plantOpen,
      orderShifts: orderShifts.length ? orderShifts : undefined,
    };
    const waveHeader =
      waves.length > 0
        ? waves
            .map((w) => {
              const t = formatPlanUpdatedAtLabel(w.createdAt);
              const delay =
                w.delayFactMin && w.delayFactMin > 0
                  ? ` · опоздание +${w.delayFactMin} мин`
                  : '';
              const sum = w.summary ? ` · ${w.summary}` : '';
              return `—— ${formatPlannerWaveLabel(w.label)}${t ? ` (${t})` : ''} · ${w.newTripCount} рейс.${delay}${sum} ——`;
            })
            .join('\n') + '\n\n'
        : '';

    // Единый отчёт: заявки + рейсы под ними + одна сводка + все замечания.
    if (reportGroups.length > 0) {
      return (
        waveHeader +
        buildUnifiedDailyPlanText({
          dateLabel: reportDateLabel || dateLabel,
          groups: reportGroups,
          ...common,
        })
      );
    }
    // Fallback без групп — компактный список по заявкам из плана.
    return (
      waveHeader +
      buildUnifiedDailyPlanText({
        dateLabel: reportDateLabel || dateLabel,
        groups: plannerOrders.map((o) => ({
          orderId: o.id,
          client: o.client,
          deliveryTime: o.deliveryTime,
          grade: o.grade || '—',
          orderVolume: o.volume,
          orderStatus: o.status || '',
          address: o.address || '',
          contactName: '',
          contactPhone: '',
          mixers: [],
        })),
        ...common,
      })
    );
  };

  const copyPlan = async (onlyNew: boolean) => {
    // В буфер — оперативный текст без выполненных (как для Макс).
    const body = buildMaxBlock({ onlyNew, excludeCompleted: true });
    if (!String(body || '').trim()) {
      await appAlert('Нечего копировать — текст плана пуст', {
        title: 'Пусто',
        variant: 'warning',
      });
      return;
    }
    const { copyTextToClipboard } = await import('@/lib/clipboard');
    const ok = await copyTextToClipboard(body);
    if (ok) {
      await appAlert(
        onlyNew
          ? 'Этап скопирован — можно вставить в Макс'
          : 'План скопирован — можно вставить в Макс',
        { title: 'Готово', variant: 'success' },
      );
    } else {
      await appAlert('Не удалось скопировать', { title: 'Ошибка', variant: 'danger' });
    }
  };

  const applyToMax = (onlyNew: boolean) => {
    if (!canMutatePlan) return;
    const activeText = buildMaxBlock({ onlyNew, excludeCompleted: true });
    const fullDayText = buildMaxBlock({ onlyNew, excludeCompleted: false });
    const draft = persist({});
    // В общий снимок дня кладём полный текст; в модалке по умолчанию — оперативный.
    schedulePublish({ draft, maxText: fullDayText, immediate: true });
    onApplyMaxText({ activeText, fullDayText });
  };

  /** Заявки, у которых в плане есть рейсы для записи в БД (не самовывоз, не done). */
  const applyableOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of trips) {
      if (t.done || t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER) continue;
      ids.add(String(t.orderId));
    }
    return ids;
  }, [trips]);

  // После пересчёта — снова отметить все заявки с рейсами к применению.
  const tripsApplyKey = useMemo(
    () =>
      [...applyableOrderIds].sort().join(',') +
      '|' +
      trips
        .filter((t) => applyableOrderIds.has(String(t.orderId)))
        .map((t) => `${t.id}:${t.loadTime}:${t.volume}`)
        .join(';'),
    [applyableOrderIds, trips],
  );

  useEffect(() => {
    setApplyOrderIds(new Set(applyableOrderIds));
  }, [tripsApplyKey, applyableOrderIds]);

  /**
   * Closed-loop объёмов: ручной add/правка volume в order_mixers → план + хвост.
   * Обратно: правка в плане → в заявку только через «Применить в заявки».
   * Не затираем локальную правку плана (override = plan ≠ fact), пока факт не изменился.
   */
  useEffect(() => {
    const nextMap = new Map<string, number>();
    for (const t of dayTrips) {
      if (t.id == null) continue;
      const id = String(t.id);
      const vol = Math.round((Number(t.volume) || 0) * 10) / 10;
      nextMap.set(id, vol);
    }

    const prev = factVolSnapshotRef.current;
    const isSeed = !factVolSeededRef.current;
    if (isSeed) {
      factVolSeededRef.current = true;
      pendingSeedVolCatchUpRef.current = true;
    } else {
      for (const [id, vol] of nextMap) {
        const p = prev.get(id);
        if (p === undefined || Math.abs(p - vol) >= 0.05) {
          pendingFactVolSyncRef.current.add(id);
        }
      }
    }
    factVolSnapshotRef.current = nextMap;

    if (
      !canMutatePlan ||
      busy ||
      isOperatorView ||
      loadingFleet ||
      !trips.length ||
      factVolSyncingRef.current
    ) {
      return;
    }

    const seedCatchUp = pendingSeedVolCatchUpRef.current;
    const pendingIds = pendingFactVolSyncRef.current;
    if (!seedCatchUp && pendingIds.size === 0) return;

    const overrides = mixerVolumeOverridesRef.current;
    const toSync: Array<{ tripId: string; volume: number; mixerNumber: string }> =
      [];

    for (const t of trips) {
      if (t.done) continue;
      const fact = planFactByTripId.get(t.id);
      if (!fact?.hasMatch || fact.matchedTripId == null || fact.factVolume == null) {
        continue;
      }
      const factVol = Math.round(Number(fact.factVolume) * 10) / 10;
      if (factVol <= 0) continue;
      const planVol = Number(t.volume) || 0;
      if (Math.abs(planVol - factVol) < 0.05) continue;

      const fid = String(fact.matchedTripId);
      const factChanged = pendingIds.has(fid);

      if (seedCatchUp && !factChanged) {
        const ov = overrides[String(t.mixerNumber)];
        // Локальная правка плана ждёт «Применить» — факт пока старый.
        if (
          ov != null &&
          Math.abs(ov - planVol) < 0.05 &&
          Math.abs(ov - factVol) >= 0.05
        ) {
          continue;
        }
        toSync.push({
          tripId: t.id,
          volume: factVol,
          mixerNumber: String(t.mixerNumber),
        });
      } else if (factChanged) {
        toSync.push({
          tripId: t.id,
          volume: factVol,
          mixerNumber: String(t.mixerNumber),
        });
      }
    }

    pendingFactVolSyncRef.current = new Set();
    pendingSeedVolCatchUpRef.current = false;

    if (toSync.length === 0) return;

    factVolSyncingRef.current = true;
    setBusy(true);

    void (async () => {
      try {
        const nextOverrides = { ...mixerVolumeOverridesRef.current };
        for (const c of toSync) {
          nextOverrides[c.mixerNumber] = c.volume;
        }
        setMixerVolumeOverrides(nextOverrides);
        mixerVolumeOverridesRef.current = nextOverrides;

        const mixersForPlan = plannerMixers.map((m) => {
          const ov = nextOverrides[String(m.number)];
          return ov != null && ov > 0 ? { ...m, volume: ov } : m;
        });

        const nowMin = nowMinutesIfDateKeyIsToday(dateKey);
        const delayFactMin = medianFactDelayMin(
          [...planFactByTripId.values()].map(
            (f) => f.deltaLoadMin ?? f.deltaReleaseMin,
          ),
        );
        const doneOrderIds = plannerOrders
          .filter((o) => {
            if (manualDone.has(String(o.id))) return true;
            return orderProgressStatus(o, dayTrips, trips, false) === 'done';
          })
          .map((o) => o.id);

        const gpsOpts = await loadLiveGpsForPlan();
        const { result, locked, shifted } = replanAfterTripVolumesChange({
          allTrips: trips,
          changes: toSync.map((c) => ({ tripId: c.tripId, volume: c.volume })),
          orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
          mixers: mixersForPlan,
          doneOrderIds,
          allowNight,
          useTraffic,
          useLiveGps,
          ...gpsOpts,
          factDelayMin: delayFactMin || undefined,
          dayTrips,
          nowMinutes: nowMin,
          calibration: calibrationRef.current || calibration,
        });
        if (!shifted) return;

        const summary =
          toSync.length === 1
            ? `${toSync[0].mixerNumber} · объём из заявки → ${toSync[0].volume} м³`
            : `объёмы из заявок (${toSync.length} рейс.)`;

        setScenarios([]);
        setActiveScenarioId(null);
        persist({ mixerVolumeOverrides: nextOverrides });
        commitWavePlan('shift', result.trips, locked, result.warnings, {
          newTripIds: [shifted.id, ...result.newTrips.map((t) => t.id)],
          summary,
        });
        setAutoStageNote(`План подтянул объём из заявки: ${summary}`);
        window.setTimeout(() => setAutoStageNote(''), 8000);
      } finally {
        factVolSyncingRef.current = false;
        setBusy(false);
      }
    })();
  }, [
    dayTrips,
    planFactByTripId,
    trips,
    canMutatePlan,
    busy,
    isOperatorView,
    loadingFleet,
    dateKey,
    plannerMixers,
    plannerOrders,
    manualDone,
    allowNight,
    useTraffic,
    calibration,
    persist,
  ]);

  const toggleApplyOrder = (orderId: string) => {
    setApplyOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const applyToOrders = async () => {
    if (!canMutatePlan) return;
    const targetIds = applyOnlySelected
      ? new Set([...applyOrderIds].filter((id) => applyableOrderIds.has(id)))
      : applyableOrderIds;

    const payloadTrips = trips
      .filter(
        (t) =>
          !t.done &&
          !t.pickup &&
          t.mixerNumber !== PICKUP_MIXER_NUMBER &&
          targetIds.has(String(t.orderId)),
      )
      .map((t, i) => ({
        orderId: t.orderId,
        mixerName: t.mixerNumber,
        volume: t.volume,
        time: t.loadTime,
        sortOrder: t.loadAtMin ?? i,
        planTripId: t.id,
      }));

    if (payloadTrips.length === 0) {
      await appAlert(
        applyOnlySelected
          ? 'Нет рейсов у выбранных заявок — отметь заявки галочкой «к применению» или сними опцию «Только выбранные».'
          : 'Нет рейсов для записи в заявки (самовывоз и отработанные не пишутся).',
        { title: 'Применить в заявки', variant: 'danger' },
      );
      return;
    }

    const orderCount = new Set(payloadTrips.map((t) => String(t.orderId))).size;
    const ordersWithManual = new Set<string>();
    for (const t of dayTrips) {
      const oid = String(t.orderId ?? t.order_id);
      if (!targetIds.has(oid)) continue;
      const st = String(t.status || 'Загрузка');
      const started = Boolean(t.loading_started_at || t.loadingStartedAt);
      if (st === 'Загрузка' && !started) ordersWithManual.add(oid);
    }
    const manualNote =
      ordersWithManual.size > 0
        ? overwriteManual
          ? `\n\n⚠ У ${ordersWithManual.size} заявок есть ручные «Загрузка» — они будут заменены планом.`
          : `\n\nУ ${ordersWithManual.size} заявок уже есть ручные назначения диспетчера — их пропустим (не затираем). Чтобы заменить — включи «Заменить ручные Загрузка».`
        : '';
    const ok = await appConfirm(
      (applyOnlySelected
        ? `Записать план в БД для ${orderCount} выбранных заявок (${payloadTrips.length} рейс.)?`
        : `Записать план в БД для всех ${orderCount} заявок из плана (${payloadTrips.length} рейс.)?`) +
        `\n\nВыехавшие и начатые на пульте не трогаем. Самовывоз пропускается.` +
        manualNote,
      {
        title: 'Применить в заявки',
        okLabel: overwriteManual ? 'Заменить и записать' : 'Применить',
        variant: 'danger',
      },
    );
    if (!ok) return;

    const userId =
      typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
    const userName =
      typeof window !== 'undefined' ? localStorage.getItem('userName') : null;
    if (!userId) {
      await appAlert('Нет userId — перелогинься', { title: 'Ошибка', variant: 'danger' });
      return;
    }

    setApplying(true);
    try {
      const res = await fetch('/api/adminCifra/logistics-plan/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          trips: payloadTrips,
          userName: userName || undefined,
          overwriteManual,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        await appAlert(data.error || 'Не удалось применить план', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }
      const links = Array.isArray(data.links)
        ? (data.links as Array<{ planTripId?: string; orderMixerId?: number }>)
        : [];
      if (links.length > 0) {
        const byPlan = new Map(
          links
            .filter((l) => l.planTripId && l.orderMixerId)
            .map((l) => [String(l.planTripId), Number(l.orderMixerId)]),
        );
        setTrips((prev) =>
          prev.map((t) => {
            const id = byPlan.get(t.id);
            return id != null ? { ...t, orderMixerId: id } : t;
          }),
        );
        setLockedTrips((prev) =>
          prev.map((t) => {
            const id = byPlan.get(t.id);
            return id != null ? { ...t, orderMixerId: id } : t;
          }),
        );
      }
      if (data.success === false || Number(data.brokenOrders) > 0) {
        await appAlert(
          data.error ||
            'Часть заявок повреждена: старые рейсы удалены, новые не записались. Проверь назначения вручную.',
          { title: 'Частичный сбой', variant: 'danger' },
        );
        return;
      }
      const skipNote =
        data.skippedOrders > 0
          ? ` Пропущено заявок: ${data.skippedOrders} (часто — уже есть ручные назначения).`
          : '';
      const linkNote =
        links.length > 0
          ? ` Связка 1:1: ${links.length} ${pluralRu(links.length, 'рейс', 'рейса', 'рейсов')}`
          : '';
      await appAlert(
        `Готово: записано ${data.insertedTotal ?? 0} ${pluralRu(Number(data.insertedTotal) || 0, 'рейс', 'рейса', 'рейсов')}, заменено ${data.deletedTotal ?? 0}.${skipNote}${linkNote} Таймлайн обновится сам.`,
        { title: 'Записано в заявки', variant: 'success' },
      );
    } catch {
      await appAlert('Сеть или сервер недоступны', { title: 'Ошибка', variant: 'danger' });
    } finally {
      setApplying(false);
    }
  };

  const resetPlan = async () => {
    if (!canMutatePlan) return;
    const ok = await appConfirm(
      'Сбросить весь расчёт за этот день? Очистятся план рейсов, фиксации и замечания у всех, кто смотрит этот день. Выбор миксеров вернётся к «своим».',
      { title: 'Сброс расчёта', okLabel: 'Сбросить', variant: 'danger' },
    );
    if (!ok) return;
    suppressPublishRef.current = true;
    if (publishTimerRef.current) {
      clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    }
    setTrips([]);
    setLockedTrips([]);
    setWarnings([]);
    setManualDone(new Set());
    setScenarios([]);
    setActiveScenarioId(null);
    setOrderShifts([]);
    setWaves([]);
    wavesRef.current = [];
    setActiveWaveId(null);
    setFleetGrowNote('');
    setAllowNight(false);
    setUseTraffic(false);
    setUseLiveGps(false);
    setMixerVolumeOverrides({});
    mixerVolumeOverridesRef.current = {};
    clearTripDrag();
    setSelectedIds(
      new Set(fleet.filter((f) => f.type === 'own').map((f) => String(f.id))),
    );
    try {
      localStorage.removeItem(draftKey(dateKey));
    } catch {
      /* ignore */
    }
    const apiDate = normalizePlanDateKey(toApiDateKey(dateKey)) || toApiDateKey(dateKey);
    try {
      await fetch(
        `/api/adminCifra/logistics-plan?date=${encodeURIComponent(apiDate)}`,
        {
          method: 'DELETE',
          headers: adminCifraAuthHeaders(),
        },
      );
    } catch {
      /* ignore */
    }
    localRevisionRef.current = 0;
    setSharedMeta(null);
    setTimeout(() => {
      suppressPublishRef.current = false;
    }, 50);
    void appAlert('Расчёт обнулён', { title: 'Готово', variant: 'success' });
  };

  const is4k = uiScale >= 1.2;

  const pullStalePlan = () => {
    if (!staleConflict) return;
    applyRemotePlan(staleConflict.record, { force: true });
  };

  const takeOverEditing = async () => {
    if (!canEditPlan || !editingOther) return;
    const ok = await appConfirm(
      `Сейчас план правит ${sharedMeta?.editingByName || 'коллега'}. Забрать редактирование? При публикации возможен конфликт версий, если у коллеги есть неопубликованные правки.`,
      { title: 'Забрать редактирование', okLabel: 'Забрать', variant: 'warning' },
    );
    if (!ok) return;
    const apiDate = normalizePlanDateKey(toApiDateKey(dateKey)) || toApiDateKey(dateKey);
    try {
      const res = await fetch('/api/adminCifra/logistics-plan', {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          date: apiDate,
          editing: true,
          forceTakeover: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(data.error || 'Не удалось забрать редактирование', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }
      const plan = data?.plan as DailyLogisticsPlanRow | undefined;
      if (plan) {
        setSharedMeta((prev) => ({
          revision: Number(plan.revision) || prev?.revision || 0,
          updatedAt: plan.updated_at || prev?.updatedAt || null,
          updatedByName: plan.updated_by_name || prev?.updatedByName || null,
          editingByName: plan.editing_by_name || null,
          editingByUserId: plan.editing_by_user_id ?? null,
          editingAt: plan.editing_at || null,
        }));
      }
      await appAlert('Редактирование у тебя. Можно считать и публиковать.', {
        title: 'Готово',
        variant: 'success',
      });
    } catch {
      await appAlert('Сеть недоступна', { title: 'Ошибка', variant: 'danger' });
    }
  };

  const publishNow = async () => {
    if (!canMutatePlan) return;
    const draft = persist({});
    const ok = await publishSharedPlan({ draft });
    if (ok) {
      await appAlert('План опубликован — коллеги видят актуальную версию', {
        title: 'Опубликовано',
        variant: 'success',
      });
    }
  };

  const tripsByOrder = useMemo(() => {
    const map = new Map<string, PlannedTrip[]>();
    // Защита от уже сохранённых дублей id (React same key на списке рейсов).
    const unique = uniquifyPlannedTripIds(trips);
    for (const t of unique) {
      const key = String(t.orderId);
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    // Live из заявки, которых нет в плане (ручная постановка диспетчера).
    for (const o of plannerOrders) {
      const oid = String(o.id);
      const planned = map.get(oid) || [];
      const orphans = orphanLiveTripsAsPlanned(o, dayTrips, planned);
      if (orphans.length === 0) continue;
      map.set(oid, uniquifyPlannedTripIds([...planned, ...orphans]));
    }
    /** 0 разгружен → 1 в работе (Загрузка/В пути/…) → 2 фантом «нет в заявке».
     *  Нельзя смотреть на factRelease (выпуск с БСУ) — он есть уже у «В пути». */
    const liveRank = (t: PlannedTrip): number => {
      if (t.done) return 0;
      const f = planFactByTripId.get(t.id);
      // orphan со sticky orderMixerId может ещё не быть в map — смотрим dayTrips
      if (!f?.hasMatch && String(t.id).startsWith('live-orphan-')) {
        const omId = String(t.orderMixerId ?? '');
        const live = dayTrips.find((d) => String(d.id) === omId);
        const st = String(live?.status || '');
        if (st === 'Разгружен' || st === 'Возврат') return 0;
        if (
          st === 'Загрузка' ||
          st === 'В пути' ||
          st === 'На объекте' ||
          st === 'Проблема'
        ) {
          return 1;
        }
        return 1;
      }
      if (!f?.hasMatch) return 2;
      const st = String(f.factStatus || '');
      if (st === 'Разгружен' || st === 'Возврат') return 0;
      if (
        st === 'Загрузка' ||
        st === 'В пути' ||
        st === 'На объекте' ||
        st === 'Проблема'
      ) {
        return 1;
      }
      return 2;
    };
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ra = liveRank(a);
        const rb = liveRank(b);
        if (ra !== rb) return ra - rb;
        const fa = planFactByTripId.get(a.id);
        const fb = planFactByTripId.get(b.id);
        const ka =
          (ra === 1 && fa?.factPlanTime
            ? parsePlanHhMm(fa.factPlanTime)
            : null) ??
          a.loadAtMin ??
          parsePlanHhMm(String(a.loadTime)) ??
          0;
        const kb =
          (rb === 1 && fb?.factPlanTime
            ? parsePlanHhMm(fb.factPlanTime)
            : null) ??
          b.loadAtMin ??
          parsePlanHhMm(String(b.loadTime)) ??
          0;
        if (ka !== kb) return ka - kb;
        return String(a.id).localeCompare(String(b.id));
      });
    }
    return map;
  }, [trips, planFactByTripId, plannerOrders, dayTrips]);

  if (isOperatorView) {
    return (
      <PlannerOperatorView
        dateLabel={dateLabel}
        trips={trips}
        planFactByTripId={planFactByTripId}
        uiScale={uiScale}
      />
    );
  }

  const sideColumn = (
    <>
      {isPageLayout ? (
        <PlannerInsightsPanel
          dateKey={toApiDateKey(dateKey)}
          uiScale={uiScale}
          canEdit={canMutatePlan}
          compact
        />
      ) : null}
      <div
        style={{
          padding: `${sp(12)}px ${sp(14)}px`,
          borderRadius: 14,
          background:
            'linear-gradient(165deg, rgba(16,185,129,0.18) 0%, rgba(15,23,42,0.92) 70%)',
          border: '1px solid rgba(16,185,129,0.35)',
          boxShadow:
            '0 8px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(167,243,208,0.18)',
          color: '#A7F3D0',
          fontSize: fs(15),
          fontWeight: 600,
          lineHeight: 1.4,
          flexShrink: 0,
        }}
      >
        {hintText || 'Подсказка парка…'}
        {fleetGrowNote ? (
          <div style={{ marginTop: sp(6), fontSize: fs(13), color: '#6EE7B7', fontWeight: 500 }}>
            {fleetGrowNote}
          </div>
        ) : null}
        {roadsNote ? (
          <div style={{ marginTop: sp(6), fontSize: fs(12), color: '#93C5FD', fontWeight: 500 }}>
            {roadsRefreshing ? '⏳ ' : '🛣 '}
            {roadsNote}
          </div>
        ) : null}
      </div>
      {waves.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: sp(6),
              marginBottom: sp(8),
              flexShrink: 0,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: fs(11),
                color: '#64748B',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginRight: 4,
              }}
            >
              Волны
            </span>
            {waves.map((w) => {
              const active = activeWaveId === w.id;
              const t = formatPlanUpdatedAtLabel(w.createdAt);
              const waveLabel = formatPlannerWaveLabel(w.label);
              return (
                <button
                  key={w.id}
                  type="button"
                  title={
                    `${waveLabel}` +
                    (t ? ` · ${t}` : '') +
                    (w.createdByName ? ` · ${w.createdByName}` : '') +
                    (w.summary ? ` · ${w.summary}` : '') +
                    (w.delayFactMin ? ` · опоздание +${w.delayFactMin} мин` : '') +
                    ` · +${w.newTripCount} рейс.`
                  }
                  onClick={() => setActiveWaveId(active ? null : w.id)}
                  style={{
                    padding: `${sp(4)}px ${sp(10)}px`,
                    borderRadius: 999,
                    border: active
                      ? '1px solid rgba(96,165,250,0.7)'
                      : '1px solid rgba(71,85,105,0.9)',
                    background: active
                      ? 'rgba(59,130,246,0.22)'
                      : w.mode === 'shift'
                        ? 'rgba(251,191,36,0.12)'
                        : 'rgba(15,23,42,0.7)',
                    color: active ? '#BFDBFE' : '#CBD5E1',
                    fontSize: fs(12),
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {waveLabel}
                  {t ? (
                    <span style={{ fontWeight: 500, color: '#64748B', marginLeft: 6 }}>
                      {t}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {activeWaveId ? (
              <span style={{ fontSize: fs(11), color: '#64748B' }}>
                {(() => {
                  const w = waves.find((x) => x.id === activeWaveId);
                  if (!w) return null;
                  const ids = new Set(w.tripIds);
                  const n = trips.filter((t) => ids.has(t.id)).length;
                  return `в плане сейчас видно ${n} рейс. этой волны (подсветка)`;
                })()}
              </span>
            ) : null}
          </div>
        ) : null}
      {/* Парк */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(10), marginBottom: sp(6) }}>
          <div style={{ fontSize: fs(13), color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1 }}>
            Миксеры в расчёт {loadingFleet ? '…' : `(${selectedIds.size}/${fleet.length})`}
          </div>
          <button
            type="button"
            onClick={selectOwn}
            disabled={!canMutatePlan}
            style={{
              ...linkBtn,
              fontSize: fs(14),
              opacity: canEditPlan ? 1 : 0.45,
              cursor: canEditPlan ? 'pointer' : 'default',
            }}
          >
            Свои
          </button>
          <button
            type="button"
            onClick={selectAll}
            disabled={!canMutatePlan}
            style={{
              ...linkBtn,
              fontSize: fs(14),
              opacity: canEditPlan ? 1 : 0.45,
              cursor: canEditPlan ? 'pointer' : 'default',
            }}
          >
            Все
          </button>
        </div>
        <div
          className="scroll-hidden"
          style={{
            maxHeight: isPageLayout ? (is4k ? sp(236) : sp(196)) : is4k ? sp(120) : sp(88),
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            gap: sp(8),
            // Иначе нижний ряд чипов визуально «режется» бордером карточки.
            paddingBottom: sp(6),
            boxSizing: 'border-box',
          }}
        >
          {rankedAll.map((m) => {
            const id = String(m.id);
            const meta = fleetById.get(id);
            return (
              <PlannerFleetMixerChip
                key={id}
                mixer={{
                  id: m.id,
                  number: m.number,
                  volume: m.volume,
                  type: m.type,
                  model: meta?.model,
                  driver: meta?.driver,
                  driverPhone: meta?.driverPhone,
                  tripCount: m.tripCount,
                }}
                selected={selectedIds.has(id)}
                disabled={!canMutatePlan}
                canEdit={canEditPlan}
                onToggle={() => toggleMixer(id)}
                fs={fs}
                sp={sp}
              />
            );
          })}
        </div>
      </div>
      {/* Варианты A/B/C при нехватке */}
      {scenarios.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: sp(8),
            flexShrink: 0,
          }}
        >
          {scenarios.map((sc) => {
            const active = activeScenarioId === sc.id;
            return (
              <div
                key={sc.id}
                style={{
                  padding: sp(10),
                  borderRadius: 12,
                  border: active
                    ? '1px solid rgba(96,165,250,0.7)'
                    : '1px solid rgba(51,65,85,0.9)',
                  background: active ? 'rgba(37,99,235,0.15)' : 'rgba(15,23,42,0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: sp(6),
                }}
              >
                <div style={{ fontSize: fs(14), fontWeight: 700, color: '#E2E8F0' }}>
                  {sc.id}. {sc.title}
                  {sc.fitsWindow ? (
                    <span style={{ marginLeft: 6, color: '#6EE7B7', fontWeight: 600, fontSize: fs(12) }}>
                      ок
                    </span>
                  ) : (
                    <span style={{ marginLeft: 6, color: '#FBBF24', fontWeight: 600, fontSize: fs(12) }}>
                      хвост {sc.uncoveredVolume.toFixed(1)} м³
                    </span>
                  )}
                </div>
                <div style={{ fontSize: fs(12), color: '#94A3B8', lineHeight: 1.35 }}>
                  {sc.summary}
                  {sc.nightHint ? ` ${sc.nightHint}` : ''}
                </div>
                <div style={{ fontSize: fs(12), color: '#64748B' }}>
                  {sc.mixerCount} микс. · {sc.tripCount} рейс.
                  {sc.orderShifts.length
                    ? ` · сдвигов ${sc.orderShifts.length}`
                    : ''}
                </div>
                <button
                  type="button"
                  onClick={() => applyScenario(sc)}
                  disabled={!canMutatePlan}
                  style={{
                    marginTop: 'auto',
                    alignSelf: 'flex-start',
                    padding: `${sp(6)}px ${sp(12)}px`,
                    borderRadius: 8,
                    border: 'none',
                    background: active ? '#3B82F6' : 'rgba(59,130,246,0.35)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: fs(13),
                    cursor: canEditPlan ? 'pointer' : 'default',
                    opacity: canEditPlan ? 1 : 0.5,
                  }}
                >
                  {active ? 'Выбран' : 'Выбрать'}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );

  // Как на 4K: средние подписи (tier 1) + заголовки блоков. Полные (tier 0)
  // на 1600–1920 тоже обрезают «Макс», поэтому не используем.
  const actionsBarRef = useRef<HTMLDivElement | null>(null);
  const [labelTier, setLabelTier] = useState(1);
  const btnSize = uiScale >= 1.2 ? 'lg' : 'sm';
  const switchSize = uiScale >= 1.2 ? 'md' : 'sm';
  const btnIcon = fs(uiScale >= 1.2 ? 16 : 14);
  const actionGap = sp(uiScale >= 1.2 ? 10 : uiScale >= 1.1 ? 8 : 6);
  const stackBlockLabels = labelTier <= 1;
  // Одна высота ряда контролов: иначе в «Параметры» (только свитчи) они выше,
  // чем свитчи рядом с крупными кнопками в «Запись».
  const controlsRowMinH = btnSize === 'lg' ? sp(48) : sp(34);

  const actionLabels = useMemo(() => {
    const tiers = [
      {
        fullDay: 'Рассчитать весь день',
        stageCalc: 'Рассчитать этап',
        lock: 'Зафиксировать текущее',
        reset: 'Сбросить расчёт',
        roads: 'Обновить дороги',
        traffic: 'Учитывать пробки',
        night: 'Включая ночь',
        gps: 'Учесть GPS',
        applyScopeOn: 'Только выбранные',
        applyScopeOff: 'Ко всем заявкам',
        overwrite: 'Заменить ручные «Загрузка»',
        publish: 'Опубликовать',
        apply: 'Применить в заявки',
        toMax: 'В Макс',
        copyPlan: 'Скопировать план',
        copyStage: 'Скопировать этап',
      },
      {
        fullDay: 'Весь день',
        stageCalc: 'Этап',
        lock: 'Зафиксировать',
        reset: 'Сбросить',
        roads: 'Дороги',
        traffic: 'Пробки',
        night: 'Ночь',
        gps: 'GPS',
        applyScopeOn: 'Выбранные',
        applyScopeOff: 'Все заявки',
        overwrite: 'Ручные загрузки',
        publish: 'Опубликовать',
        apply: 'В заявки',
        toMax: 'В Макс',
        copyPlan: 'Копия плана',
        copyStage: 'Копия этапа',
      },
      {
        fullDay: 'Весь день',
        stageCalc: 'Этап',
        lock: 'Фикс',
        reset: 'Сброс',
        roads: 'Дороги',
        traffic: 'Пробки',
        night: 'Ночь',
        gps: 'GPS',
        applyScopeOn: 'Выбранные',
        applyScopeOff: 'Все',
        overwrite: 'Ручные',
        publish: 'Опубликовать',
        apply: 'В заявки',
        toMax: 'В Макс',
        copyPlan: 'План',
        copyStage: 'Этап',
      },
    ] as const;
    const base = tiers[Math.min(2, Math.max(0, labelTier))];
    return {
      fullDay: busy ? 'Считаю…' : base.fullDay,
      stageCalc: base.stageCalc,
      lock: base.lock,
      reset: base.reset,
      roads: roadsRefreshing ? (labelTier === 0 ? 'Дороги…' : '…') : base.roads,
      traffic: base.traffic,
      night: base.night,
      gps: base.gps,
      applyScope: applyOnlySelected ? base.applyScopeOn : base.applyScopeOff,
      overwrite: base.overwrite,
      publish: publishing ? (labelTier === 0 ? 'Публикую…' : '…') : base.publish,
      apply: applying ? (labelTier === 0 ? 'Пишу…' : '…') : base.apply,
      toMax: base.toMax,
      copyPlan: base.copyPlan,
      copyStage: base.copyStage,
    };
  }, [
    labelTier,
    busy,
    roadsRefreshing,
    applyOnlySelected,
    publishing,
    applying,
  ]);

  useLayoutEffect(() => {
    const el = actionsBarRef.current;
    if (!el) return;

    const tierForWidth = (w: number) => {
      // 1600 / 1920 / 4K — один режим: medium. Короче только на узкой панели.
      if (w >= 1100) return 1;
      return 2;
    };

    const apply = () => {
      const next = tierForWidth(el.clientWidth);
      setLabelTier((t) => (t === next ? t : next));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [btnSize, actionGap, uiScale]);

  const actionBlock = (
    label: string,
    children: ReactNode,
    opts?: { dividerBefore?: boolean },
  ) => (
    <div
      style={{
        display: 'flex',
        flexDirection: stackBlockLabels ? 'column' : 'row',
        alignItems: stackBlockLabels ? 'stretch' : 'center',
        justifyContent: 'flex-start',
        gap: stackBlockLabels ? sp(6) : actionGap,
        flexShrink: 0,
        flexGrow: 0,
        paddingLeft: opts?.dividerBefore ? sp(stackBlockLabels ? 14 : 8) : 0,
        borderLeft: opts?.dividerBefore
          ? '1px solid rgba(71,85,105,0.9)'
          : undefined,
        marginLeft: opts?.dividerBefore ? sp(stackBlockLabels ? 4 : 2) : 0,
      }}
    >
      <span
        style={{
          fontSize: fs(stackBlockLabels ? 11 : 9),
          fontWeight: 800,
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          lineHeight: 1.1,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: actionGap,
          flexShrink: 0,
          flexWrap: 'nowrap',
          minHeight: controlsRowMinH,
        }}
      >
        {children}
      </div>
    </div>
  );

  // Четыре блока в ряд, без «дыры» flex:1. На широком — равномерно; Макс не уезжает.
  const actionsColumn = (
    <div
      ref={actionsBarRef}
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: stackBlockLabels ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: actionGap,
        flexShrink: 0,
        width: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'hidden',
        paddingBottom: sp(2),
        minWidth: 0,
      }}
    >
      {actionBlock(
        'Расчёт',
        <>
          <DarkHoverTip tip="Полный пересчёт плана на весь день" maxWidth={260}>
            <ModalActionButton
              color="#34D399"
              icon={<Calculator size={btnIcon} />}
              label={actionLabels.fullDay}
              size={btnSize}
              onClick={() => void runPlan('full_day')}
              disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Пересчёт только незафиксированного этапа" maxWidth={280}>
            <ModalActionButton
              color="#60A5FA"
              icon={<Layers size={btnIcon} />}
              label={actionLabels.stageCalc}
              size={btnSize}
              onClick={() => void runPlan('stage')}
              disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Зафиксировать текущие рейсы — этап их не пересчитает" maxWidth={300}>
            <ModalActionButton
              color="#94A3B8"
              icon={<Lock size={btnIcon} />}
              label={actionLabels.lock}
              size={btnSize}
              onClick={lockAllCurrent}
              disabled={!canMutatePlan || !trips.length}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Сбросить расчёт плана" maxWidth={220}>
            <ModalActionButton
              color="#F87171"
              icon={<RefreshCw size={btnIcon} />}
              label={actionLabels.reset}
              size={btnSize}
              onClick={() => void resetPlan()}
              disabled={
                !canEditPlan ||
                (!trips.length && !lockedTrips.length && warnings.length === 0)
              }
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Обновить времена дороги по маршрутам заявок" maxWidth={280}>
            <ModalActionButton
              color="#38BDF8"
              icon={<Route size={btnIcon} />}
              label={actionLabels.roads}
              size={btnSize}
              onClick={() => void refreshRoadTimes()}
              disabled={roadsRefreshing || !orders.length}
            />
          </DarkHoverTip>
        </>,
      )}
      {actionBlock(
        'Параметры',
        <>
          <DarkHoverTip
            tip="Утро 7–9 и вечер 16–18: дорога чуть дольше (×1.25–1.35). Выкл — без надбавки за пробки."
            maxWidth={340}
          >
            <PlannerSwitch
              checked={useTraffic}
              disabled={!canMutatePlan}
              accent="sky"
              size={switchSize}
              label={actionLabels.traffic}
              onChange={(next) => {
                setUseTraffic(next);
                setScenarios([]);
                setActiveScenarioId(null);
              }}
            />
          </DarkHoverTip>
          <DarkHoverTip
            tip="Выкл — возврат на базу ≤ 21:00. Вкл — рейсы после 21:00 и на следующие сутки."
            maxWidth={360}
          >
            <PlannerSwitch
              checked={allowNight}
              disabled={!canMutatePlan}
              accent="amber"
              size={switchSize}
              label={actionLabels.night}
              onChange={(next) => {
                setAllowNight(next);
                setScenarios([]);
                setActiveScenarioId(null);
              }}
            />
          </DarkHoverTip>
          <DarkHoverTip
            tip="Свежий online GPS миксеров: доезд до завода и уточнение возврата. Без сигнала — как раньше. Для другого дня GPS не сдвигает готовность."
            maxWidth={360}
          >
            <PlannerSwitch
              checked={useLiveGps}
              disabled={!canMutatePlan}
              accent="emerald"
              size={switchSize}
              label={actionLabels.gps}
              onChange={(next) => {
                setUseLiveGps(next);
                setScenarios([]);
                setActiveScenarioId(null);
              }}
            />
          </DarkHoverTip>
        </>,
        { dividerBefore: true },
      )}
      {actionBlock(
        'Запись',
        <>
          <DarkHoverTip
            tip="Выкл — «Применить в заявки» пишет во все заявки с рейсами. Вкл — только в отмеченные фиолетовым в списке."
            maxWidth={340}
          >
            <PlannerSwitch
              checked={applyOnlySelected}
              disabled={!canMutatePlan}
              accent="violet"
              size={switchSize}
              label={actionLabels.applyScope}
              onChange={setApplyOnlySelected}
              suffix={
                applyOnlySelected && applyableOrderIds.size > 0 ? (
                  <span
                    style={{
                      color: '#A78BFA',
                      fontWeight: 700,
                      fontSize: fs(uiScale >= 1.2 ? 13 : 11),
                    }}
                  >
                    ({[...applyOrderIds].filter((id) => applyableOrderIds.has(id)).length}/
                    {applyableOrderIds.size})
                  </span>
                ) : null
              }
            />
          </DarkHoverTip>
          <DarkHoverTip
            tip="По умолчанию выкл: ручные «Загрузка» интеллект не трогает. Вкл — заменить их планом."
            maxWidth={360}
          >
            <PlannerSwitch
              checked={overwriteManual}
              disabled={!canMutatePlan}
              accent="rose"
              size={switchSize}
              label={actionLabels.overwrite}
              onChange={setOverwriteManual}
            />
          </DarkHoverTip>
          <DarkHoverTip
            tip="Сохранить общий план дня для всех диспетчеров. Не пишет миксеры в заявки."
            maxWidth={320}
          >
            <ModalActionButton
              color={publishDirty ? '#A78BFA' : '#818CF8'}
              icon={<Upload size={btnIcon} />}
              label={actionLabels.publish}
              size={btnSize}
              onClick={() => void publishNow()}
              disabled={!canMutatePlan || publishing || (!publishDirty && !trips.length)}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Записать рассчитанные рейсы в заявки." maxWidth={280}>
            <ModalActionButton
              color="#C084FC"
              icon={<Database size={btnIcon} />}
              label={actionLabels.apply}
              size={btnSize}
              onClick={() => void applyToOrders()}
              disabled={!canMutatePlan || applying || applyableOrderIds.size === 0}
            />
          </DarkHoverTip>
        </>,
        { dividerBefore: true },
      )}
      {actionBlock(
        'Макс',
        <>
          <DarkHoverTip
            tip="Окно с текстом плана: правка и копирование для Макс. Сохраняет снимок в общий план."
            maxWidth={340}
          >
            <ModalActionButton
              color="#A78BFA"
              icon={<Send size={btnIcon} />}
              label={actionLabels.toMax}
              size={btnSize}
              onClick={() => applyToMax(false)}
              disabled={!canMutatePlan || !trips.length}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Сразу в буфер: оперативный план дня без выполненных." maxWidth={300}>
            <ModalActionButton
              color="#34D399"
              icon={<Copy size={btnIcon} />}
              label={actionLabels.copyPlan}
              size={btnSize}
              onClick={() => void copyPlan(false)}
              disabled={!trips.length}
            />
          </DarkHoverTip>
          <DarkHoverTip tip="Сразу в буфер: только незафиксированный этап." maxWidth={300}>
            <ModalActionButton
              color="#60A5FA"
              icon={<Copy size={btnIcon} />}
              label={actionLabels.copyStage}
              size={btnSize}
              onClick={() => void copyPlan(true)}
              disabled={!trips.some((t) => !t.locked && !t.done)}
            />
          </DarkHoverTip>
        </>,
        { dividerBefore: true },
      )}
    </div>
  );

  if (isPageLayout) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
          height: '100%',
          gap: sp(10),
        }}
      >
        {(sharedMeta?.updatedByName ||
          editingOther ||
          publishDirty ||
          staleConflict ||
          autoStageNote ||
          !canEditPlan) && (
          <div
            style={volumeCardStyle({
              fontSize: fs(13),
              color: '#94A3B8',
              lineHeight: 1.45,
              flexShrink: 0,
              padding: `${sp(10)}px ${sp(14)}px`,
              borderRadius: 16,
            })}
          >
            {sharedMeta?.updatedByName ? (
              <span style={{ display: 'block', color: '#CBD5E1', fontSize: fs(13) }}>
                План общий · обновил {sharedMeta.updatedByName}
                {sharedMeta.updatedAt
                  ? ` в ${formatPlanUpdatedAtLabel(sharedMeta.updatedAt)}`
                  : ''}
                {sharedMeta.revision ? ` · вер. ${sharedMeta.revision}` : ''}
              </span>
            ) : null}
            {editingOther ? (
              <span
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 4,
                  color: '#FCD34D',
                  fontSize: fs(13),
                }}
              >
                Сейчас правит {sharedMeta?.editingByName}
                {sharedMeta?.editingAt
                  ? ` (активность ${formatPlanUpdatedAtLabel(sharedMeta.editingAt)})`
                  : ''}
                — расчёт и запись заблокированы.
                <button type="button" onClick={() => void takeOverEditing()} style={linkBtn}>
                  Забрать редактирование
                </button>
              </span>
            ) : null}
            {publishDirty && canEditPlan ? (
              <span style={{ display: 'block', marginTop: 4, color: '#A78BFA', fontSize: fs(13) }}>
                Есть неопубликованные изменения — нажми «Опубликовать», чтобы коллеги увидели.
              </span>
            ) : null}
            {staleConflict ? (
              <span
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 6,
                  color: '#FCA5A5',
                  fontSize: fs(13),
                }}
              >
                План устарел
                {staleConflict.updatedByName
                  ? ` — опубликовал ${staleConflict.updatedByName}`
                  : ''}
                {staleConflict.updatedAt
                  ? ` в ${formatPlanUpdatedAtLabel(staleConflict.updatedAt)}`
                  : ''}
                . Локальные правки могут конфликтовать.
                <button type="button" onClick={pullStalePlan} style={linkBtn}>
                  Подтянуть их версию
                </button>
              </span>
            ) : null}
            {autoStageNote ? (
              <span style={{ display: 'block', marginTop: 4, color: '#6EE7B7', fontSize: fs(13) }}>
                {autoStageNote}
              </span>
            ) : null}
            {!canEditPlan ? (
              <span style={{ display: 'block', marginTop: 4, color: '#FBBF24', fontSize: fs(13) }}>
                Только просмотр — расчёт и запись в заявки недоступны для твоей роли.
              </span>
            ) : null}
          </div>
        )}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: stackColumns ? '1fr' : 'minmax(0, 1.62fr) minmax(300px, 1fr)',
            gridTemplateRows: stackColumns ? 'minmax(0, 1fr) auto' : '1fr',
            gap: sp(12),
          }}
        >
          <div
            style={volumeCardStyle({
              background: CARD_GRADIENT_SOFT,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              order: stackColumns ? 0 : undefined,
              padding: `${sp(12)}px ${sp(14)}px`,
              borderRadius: 18,
            })}
          >
      {/* Заявки + рейсы */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
<div style={{ fontSize: fs(13), color: '#64748B', fontWeight: 700, marginBottom: sp(6), textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
          Заявки дня{' '}
          {trips.length > 0
            ? `· план ${trips.length} ${pluralRu(trips.length, 'рейс', 'рейса', 'рейсов')}`
            : ''}
          {sharedMeta?.updatedByName ? (
            <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#475569', marginLeft: 8 }}>
              · общий
            </span>
          ) : null}
        </div>
        <div
          className="scroll-subtle"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: sp(12),
            paddingRight: sp(8),
            boxSizing: 'border-box',
          }}
        >
          {plannerOrders.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: fs(14) }}>Нет активных заявок</div>
          ) : (
            plannerOrders.map((o) => {
              const st = orderProgressStatus(
                o,
                dayTrips,
                trips,
                manualDone.has(String(o.id)),
              );
              const badge =
                st === 'done'
                  ? { bg: 'rgba(16,185,129,0.2)', color: '#6EE7B7', label: 'отработана' }
                  : st === 'in_work'
                    ? { bg: 'rgba(250,204,21,0.18)', color: '#FDE047', label: 'в работе' }
                    : { bg: 'rgba(148,163,184,0.15)', color: '#94A3B8', label: 'в плане' };
              const orderTrips = tripsByOrder.get(String(o.id)) || [];
              const pickup = isPickupOrder(o.address);
              const oid = String(o.id);
              const canApply = applyableOrderIds.has(oid);
              const selectedForApply = applyOrderIds.has(oid);
              return (
                <div
                  key={oid}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0,
                    flexShrink: 0,
                    minWidth: 0,
                    maxWidth: '100%',
                    borderRadius: 14,
                    overflow: 'hidden',
                    background:
                      st === 'done'
                        ? 'rgba(15,23,42,0.72)'
                        : 'rgba(15,23,42,0.78)',
                    border:
                      st === 'done'
                        ? '1px solid rgba(52,211,153,0.4)'
                        : st === 'in_work'
                          ? '1px solid rgba(250,204,21,0.38)'
                          : '1px solid rgba(148,163,184,0.34)',
                    boxShadow:
                      '0 8px 20px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.04)',
                  }}
                >
                  <PlannerOrderHeader
                    order={o}
                    status={st}
                    badge={badge}
                    pickup={pickup}
                    dayTrips={dayTrips}
                    manualDone={manualDone.has(oid)}
                    canMutatePlan={canMutatePlan}
                    canEditPlan={canEditPlan}
                    applyOnlySelected={applyOnlySelected}
                    canApply={canApply}
                    selectedForApply={selectedForApply}
                    dragOver={dragOverOrderId === oid}
                    dragHint={
                      dragTripId && !pickup && st !== 'done'
                        ? 'Отпусти здесь — рейс в конец заявки'
                        : undefined
                    }
                    fs={fs}
                    sp={sp}
                    onToggleDone={() => toggleOrderDone(oid)}
                    onToggleApply={() => toggleApplyOrder(oid)}
                    onDragOver={(e) => {
                      if (
                        !canMutatePlan ||
                        !dragTripIdRef.current ||
                        pickup ||
                        st === 'done'
                      ) {
                        return;
                      }
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverOrderId(oid);
                      setDragOverTripId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const moving =
                        e.dataTransfer.getData('text/plain') ||
                        dragTripIdRef.current;
                      if (!canMutatePlan || !moving || pickup || st === 'done') return;
                      void reorderTrip(moving, oid, null);
                    }}
                    onDragLeave={() => {
                      setDragOverOrderId((prev) => (prev === oid ? null : prev));
                    }}
                  />
                  {orderTrips.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: sp(3),
                        flexShrink: 0,
                        padding: `${sp(6)}px ${sp(6)}px ${sp(7)}px`,
                        background: 'rgba(2,6,23,0.55)',
                        boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.4)',
                      }}
                    >
                  {orderTrips.map((t) => {
                    const waveHighlight =
                      activeWaveId != null &&
                      waves.some(
                        (w) => w.id === activeWaveId && w.tripIds.includes(t.id),
                      );
                    const isLiveOrphan = String(t.id).startsWith('live-orphan-');
                    return (
                      <div
                        key={t.id}
                        style={{
                          opacity: dragTripId === t.id ? 0.55 : 1,
                          flexShrink: 0,
                          minWidth: 0,
                          maxWidth: '100%',
                        }}
                      >
                        <PlannerTripFactRow
                          trip={t}
                          fact={
                            planFactByTripId.get(t.id) || {
                              matchedTripId: null,
                              factStatus: null,
                              factLoadStart: null,
                              factRelease: null,
                              factPlanTime: null,
                              factVolume: null,
                              factMixerNumber: null,
                              deltaLoadMin: null,
                              deltaReleaseMin: null,
                              noOperatorRecord: false,
                              hasMatch: false,
                            }
                          }
                          fs={fs}
                          sp={sp}
                          busy={busy || applying}
                          canShiftPlan={canMutatePlan && !isLiveOrphan}
                          onShiftLoadTime={(id, hhmm) => void shiftTripLoad(id, hhmm)}
                          onTripDelayMin={(id, mins) => void applyTripDelay(id, mins)}
                          onPlanVolumeChange={(id, vol) => void applyTripPlanVolume(id, vol)}
                          onSetTripLocked={
                            canMutatePlan && !isLiveOrphan
                              ? setTripLocked
                              : undefined
                          }
                          canDrag={canMutatePlan && !isLiveOrphan}
                          dragOver={dragOverTripId === t.id}
                          waveHighlight={waveHighlight}
                          onDragStartTrip={(id) => {
                            dragTripIdRef.current = id;
                            setDragTripId(id);
                            setDragOverTripId(null);
                            setDragOverOrderId(null);
                          }}
                          onDragOverTrip={(id) => {
                            const moving = dragTripIdRef.current;
                            if (!moving || id === moving) return;
                            setDragOverTripId(id);
                            setDragOverOrderId(null);
                          }}
                          onDropOnTrip={(id) => {
                            const moving = dragTripIdRef.current;
                            if (!moving || moving === id) {
                              clearTripDrag();
                              return;
                            }
                            void reorderTrip(moving, oid, id);
                          }}
                          onDragEndTrip={clearTripDrag}
                        />
                      </div>
                    );
                  })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          {/* Замечания внутри скролла заявок — не сжимают высоту списка */}
          {warnings.length > 0 && (
            <div
              style={{
                fontSize: fs(12),
                color: '#FBBF24',
                lineHeight: 1.35,
                padding: `${sp(8)}px ${sp(10)}px`,
                borderRadius: 12,
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
                marginTop: sp(4),
              }}
            >
              <div style={{ fontWeight: 700, color: '#FCD34D', marginBottom: 4 }}>
                Замечания ({warnings.length}): очередь на соске, занятость, стыки заливки
              </div>
              {warnings.map((w, i) => (
                <div key={i}>• {w.message}</div>
              ))}
            </div>
          )}
        </div>
      </div>

          </div>
          <div
            className="scroll-subtle"
            style={volumeCardStyle({
              background: CARD_GRADIENT_SOFT,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: sp(10),
              padding: `${sp(12)}px ${sp(14)}px`,
              borderRadius: 18,
              order: stackColumns ? 1 : undefined,
            })}
          >
            {sideColumn}
          </div>
        </div>
        <div
          style={volumeCardStyle({
            flexShrink: 0,
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: sp(8),
            padding:
              uiScale >= 1.2
                ? `${sp(14)}px ${sp(16)}px`
                : `${sp(10)}px ${sp(12)}px`,
            borderRadius: 18,
          })}
        >
          {actionsColumn}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
        height: '100%',
        gap: sp(10),
      }}
    >

      <div style={{ fontSize: fs(14), color: '#94A3B8', lineHeight: 1.45, flexShrink: 0 }}>
        {dateLabel}: расчёт сам по себе заявки не меняет — только кнопка «Применить в заявки».
        Ручные миксеры диспетчера учитываются в остатке объёма и по умолчанию не затираются.
        Один миксер — несколько рейсов за день. Приоритет: свои и часто ездившие.
        {sharedMeta?.updatedByName ? (
          <span style={{ display: 'block', marginTop: 4, color: '#64748B', fontSize: fs(13) }}>
            План общий · обновил {sharedMeta.updatedByName}
            {sharedMeta.updatedAt
              ? ` в ${formatPlanUpdatedAtLabel(sharedMeta.updatedAt)}`
              : ''}
            {sharedMeta.revision ? ` · вер. ${sharedMeta.revision}` : ''}
          </span>
        ) : null}
        {editingOther ? (
          <span
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
              color: '#FCD34D',
              fontSize: fs(13),
            }}
          >
            Сейчас правит {sharedMeta?.editingByName}
            {sharedMeta?.editingAt
              ? ` (активность ${formatPlanUpdatedAtLabel(sharedMeta.editingAt)})`
              : ''}
            — расчёт и запись заблокированы.
            <button type="button" onClick={() => void takeOverEditing()} style={linkBtn}>
              Забрать редактирование
            </button>
          </span>
        ) : null}
        {publishDirty && canEditPlan ? (
          <span style={{ display: 'block', marginTop: 4, color: '#A78BFA', fontSize: fs(13) }}>
            Есть неопубликованные изменения — нажми «Опубликовать», чтобы коллеги увидели.
          </span>
        ) : null}
        {staleConflict ? (
          <span
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              marginTop: 6,
              color: '#FCA5A5',
              fontSize: fs(13),
            }}
          >
            План устарел
            {staleConflict.updatedByName
              ? ` — опубликовал ${staleConflict.updatedByName}`
              : ''}
            {staleConflict.updatedAt
              ? ` в ${formatPlanUpdatedAtLabel(staleConflict.updatedAt)}`
              : ''}
            . Локальные правки могут конфликтовать.
            <button type="button" onClick={pullStalePlan} style={linkBtn}>
              Подтянуть их версию
            </button>
          </span>
        ) : null}
        {autoStageNote ? (
          <span style={{ display: 'block', marginTop: 4, color: '#6EE7B7', fontSize: fs(13) }}>
            {autoStageNote}
          </span>
        ) : null}
        {!canEditPlan ? (
          <span style={{ display: 'block', marginTop: 4, color: '#FBBF24', fontSize: fs(13) }}>
            Только просмотр — расчёт и запись в заявки недоступны для твоей роли.
          </span>
        ) : null}
      </div>


      <div
        style={{
          padding: `${sp(10)}px ${sp(14)}px`,
          borderRadius: 14,
          background: 'rgba(16,185,129,0.08)',
          border: '1px solid rgba(16,185,129,0.25)',
          color: '#A7F3D0',
          fontSize: fs(15),
          fontWeight: 600,
          lineHeight: 1.4,
          flexShrink: 0,
        }}
      >
        {hintText || 'Подсказка парка…'}
        {fleetGrowNote ? (
          <div style={{ marginTop: sp(6), fontSize: fs(13), color: '#6EE7B7', fontWeight: 500 }}>
            {fleetGrowNote}
          </div>
        ) : null}
        {roadsNote ? (
          <div style={{ marginTop: sp(6), fontSize: fs(12), color: '#93C5FD', fontWeight: 500 }}>
            {roadsRefreshing ? '⏳ ' : '🛣 '}
            {roadsNote}
          </div>
        ) : null}
      </div>


      {/* Заявки + рейсы: занимает оставшуюся высоту окна, при расчёте только скролл */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {waves.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: sp(6),
              marginBottom: sp(8),
              flexShrink: 0,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: fs(11),
                color: '#64748B',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginRight: 4,
              }}
            >
              Волны
            </span>
            {waves.map((w) => {
              const active = activeWaveId === w.id;
              const t = formatPlanUpdatedAtLabel(w.createdAt);
              const waveLabel = formatPlannerWaveLabel(w.label);
              return (
                <button
                  key={w.id}
                  type="button"
                  title={
                    `${waveLabel}` +
                    (t ? ` · ${t}` : '') +
                    (w.createdByName ? ` · ${w.createdByName}` : '') +
                    (w.summary ? ` · ${w.summary}` : '') +
                    (w.delayFactMin ? ` · опоздание +${w.delayFactMin} мин` : '') +
                    ` · +${w.newTripCount} рейс.`
                  }
                  onClick={() => setActiveWaveId(active ? null : w.id)}
                  style={{
                    padding: `${sp(4)}px ${sp(10)}px`,
                    borderRadius: 999,
                    border: active
                      ? '1px solid rgba(96,165,250,0.7)'
                      : '1px solid rgba(71,85,105,0.9)',
                    background: active
                      ? 'rgba(59,130,246,0.22)'
                      : w.mode === 'shift'
                        ? 'rgba(251,191,36,0.12)'
                        : 'rgba(15,23,42,0.7)',
                    color: active ? '#BFDBFE' : '#CBD5E1',
                    fontSize: fs(12),
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {waveLabel}
                  {t ? (
                    <span style={{ fontWeight: 500, color: '#64748B', marginLeft: 6 }}>
                      {t}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {activeWaveId ? (
              <span style={{ fontSize: fs(11), color: '#64748B' }}>
                {(() => {
                  const w = waves.find((x) => x.id === activeWaveId);
                  if (!w) return null;
                  const ids = new Set(w.tripIds);
                  const n = trips.filter((t) => ids.has(t.id)).length;
                  return `в плане сейчас видно ${n} рейс. этой волны (подсветка)`;
                })()}
              </span>
            ) : null}
          </div>
        ) : null}

        <div style={{ fontSize: fs(13), color: '#64748B', fontWeight: 700, marginBottom: sp(6), textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
          Заявки дня{' '}
          {trips.length > 0
            ? `· план ${trips.length} ${pluralRu(trips.length, 'рейс', 'рейса', 'рейсов')}`
            : ''}
          {sharedMeta?.updatedByName ? (
            <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0, color: '#475569', marginLeft: 8 }}>
              · общий
            </span>
          ) : null}
        </div>
        <div
          className="scroll-subtle"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: sp(12),
            paddingRight: sp(8),
            boxSizing: 'border-box',
          }}
        >
          {plannerOrders.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: fs(14) }}>Нет активных заявок</div>
          ) : (
            plannerOrders.map((o) => {
              const st = orderProgressStatus(
                o,
                dayTrips,
                trips,
                manualDone.has(String(o.id)),
              );
              const badge =
                st === 'done'
                  ? { bg: 'rgba(16,185,129,0.2)', color: '#6EE7B7', label: 'отработана' }
                  : st === 'in_work'
                    ? { bg: 'rgba(250,204,21,0.18)', color: '#FDE047', label: 'в работе' }
                    : { bg: 'rgba(148,163,184,0.15)', color: '#94A3B8', label: 'в плане' };
              const orderTrips = tripsByOrder.get(String(o.id)) || [];
              const pickup = isPickupOrder(o.address);
              const oid = String(o.id);
              const canApply = applyableOrderIds.has(oid);
              const selectedForApply = applyOrderIds.has(oid);
              return (
                <div
                  key={oid}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0,
                    flexShrink: 0,
                    minWidth: 0,
                    maxWidth: '100%',
                    borderRadius: 14,
                    overflow: 'hidden',
                    background:
                      st === 'done'
                        ? 'rgba(15,23,42,0.72)'
                        : 'rgba(15,23,42,0.78)',
                    border:
                      st === 'done'
                        ? '1px solid rgba(52,211,153,0.4)'
                        : st === 'in_work'
                          ? '1px solid rgba(250,204,21,0.38)'
                          : '1px solid rgba(148,163,184,0.34)',
                    boxShadow:
                      '0 8px 20px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.04)',
                  }}
                >
                  <PlannerOrderHeader
                    order={o}
                    status={st}
                    badge={badge}
                    pickup={pickup}
                    dayTrips={dayTrips}
                    manualDone={manualDone.has(oid)}
                    canMutatePlan={canMutatePlan}
                    canEditPlan={canEditPlan}
                    applyOnlySelected={applyOnlySelected}
                    canApply={canApply}
                    selectedForApply={selectedForApply}
                    dragOver={dragOverOrderId === oid}
                    dragHint={
                      dragTripId && !pickup && st !== 'done'
                        ? 'Отпусти здесь — рейс в конец заявки'
                        : undefined
                    }
                    fs={fs}
                    sp={sp}
                    onToggleDone={() => toggleOrderDone(oid)}
                    onToggleApply={() => toggleApplyOrder(oid)}
                    onDragOver={(e) => {
                      if (
                        !canMutatePlan ||
                        !dragTripIdRef.current ||
                        pickup ||
                        st === 'done'
                      ) {
                        return;
                      }
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverOrderId(oid);
                      setDragOverTripId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const moving =
                        e.dataTransfer.getData('text/plain') ||
                        dragTripIdRef.current;
                      if (!canMutatePlan || !moving || pickup || st === 'done') return;
                      void reorderTrip(moving, oid, null);
                    }}
                    onDragLeave={() => {
                      setDragOverOrderId((prev) => (prev === oid ? null : prev));
                    }}
                  />
                  {orderTrips.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: sp(3),
                        flexShrink: 0,
                        padding: `${sp(6)}px ${sp(6)}px ${sp(7)}px`,
                        background: 'rgba(2,6,23,0.55)',
                        boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.4)',
                      }}
                    >
                  {orderTrips.map((t) => {
                    const waveHighlight =
                      activeWaveId != null &&
                      waves.some(
                        (w) => w.id === activeWaveId && w.tripIds.includes(t.id),
                      );
                    const isLiveOrphan = String(t.id).startsWith('live-orphan-');
                    return (
                      <div
                        key={t.id}
                        style={{
                          opacity: dragTripId === t.id ? 0.55 : 1,
                          flexShrink: 0,
                          minWidth: 0,
                          maxWidth: '100%',
                        }}
                      >
                        <PlannerTripFactRow
                          trip={t}
                          fact={
                            planFactByTripId.get(t.id) || {
                              matchedTripId: null,
                              factStatus: null,
                              factLoadStart: null,
                              factRelease: null,
                              factPlanTime: null,
                              factVolume: null,
                              factMixerNumber: null,
                              deltaLoadMin: null,
                              deltaReleaseMin: null,
                              noOperatorRecord: false,
                              hasMatch: false,
                            }
                          }
                          fs={fs}
                          sp={sp}
                          busy={busy || applying}
                          canShiftPlan={canMutatePlan && !isLiveOrphan}
                          onShiftLoadTime={(id, hhmm) => void shiftTripLoad(id, hhmm)}
                          onTripDelayMin={(id, mins) => void applyTripDelay(id, mins)}
                          onPlanVolumeChange={(id, vol) => void applyTripPlanVolume(id, vol)}
                          onSetTripLocked={
                            canMutatePlan && !isLiveOrphan
                              ? setTripLocked
                              : undefined
                          }
                          canDrag={canMutatePlan && !isLiveOrphan}
                          dragOver={dragOverTripId === t.id}
                          waveHighlight={waveHighlight}
                          onDragStartTrip={(id) => {
                            dragTripIdRef.current = id;
                            setDragTripId(id);
                            setDragOverTripId(null);
                            setDragOverOrderId(null);
                          }}
                          onDragOverTrip={(id) => {
                            const moving = dragTripIdRef.current;
                            if (!moving || id === moving) return;
                            setDragOverTripId(id);
                            setDragOverOrderId(null);
                          }}
                          onDropOnTrip={(id) => {
                            const moving = dragTripIdRef.current;
                            if (!moving || moving === id) {
                              clearTripDrag();
                              return;
                            }
                            void reorderTrip(moving, oid, id);
                          }}
                          onDragEndTrip={clearTripDrag}
                        />
                      </div>
                    );
                  })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}

          {/* Замечания внутри скролла заявок — не сжимают высоту списка */}
          {warnings.length > 0 && (
            <div
              style={{
                fontSize: fs(12),
                color: '#FBBF24',
                lineHeight: 1.35,
                padding: `${sp(8)}px ${sp(10)}px`,
                borderRadius: 12,
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
                marginTop: sp(4),
              }}
            >
              <div style={{ fontWeight: 700, color: '#FCD34D', marginBottom: 4 }}>
                Замечания ({warnings.length}): очередь на соске, занятость, стыки заливки
              </div>
              {warnings.map((w, i) => (
                <div key={i}>• {w.message}</div>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* Парк */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(10), marginBottom: sp(6) }}>
          <div style={{ fontSize: fs(13), color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1 }}>
            Миксеры в расчёт {loadingFleet ? '…' : `(${selectedIds.size}/${fleet.length})`}
          </div>
          <button
            type="button"
            onClick={selectOwn}
            disabled={!canMutatePlan}
            style={{
              ...linkBtn,
              fontSize: fs(14),
              opacity: canEditPlan ? 1 : 0.45,
              cursor: canEditPlan ? 'pointer' : 'default',
            }}
          >
            Свои
          </button>
          <button
            type="button"
            onClick={selectAll}
            disabled={!canMutatePlan}
            style={{
              ...linkBtn,
              fontSize: fs(14),
              opacity: canEditPlan ? 1 : 0.45,
              cursor: canEditPlan ? 'pointer' : 'default',
            }}
          >
            Все
          </button>
        </div>
        <div
          className="scroll-hidden"
          style={{
            maxHeight: isPageLayout ? (is4k ? sp(236) : sp(196)) : is4k ? sp(136) : sp(100),
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            gap: sp(8),
            paddingBottom: sp(6),
            boxSizing: 'border-box',
          }}
        >
          {rankedAll.map((m) => {
            const id = String(m.id);
            const meta = fleetById.get(id);
            return (
              <PlannerFleetMixerChip
                key={id}
                mixer={{
                  id: m.id,
                  number: m.number,
                  volume: m.volume,
                  type: m.type,
                  model: meta?.model,
                  driver: meta?.driver,
                  driverPhone: meta?.driverPhone,
                  tripCount: m.tripCount,
                }}
                selected={selectedIds.has(id)}
                disabled={!canMutatePlan}
                canEdit={canEditPlan}
                onToggle={() => toggleMixer(id)}
                fs={fs}
                sp={sp}
              />
            );
          })}
        </div>
      </div>


      {/* Варианты A/B/C при нехватке */}
      {scenarios.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: sp(8),
            flexShrink: 0,
          }}
        >
          {scenarios.map((sc) => {
            const active = activeScenarioId === sc.id;
            return (
              <div
                key={sc.id}
                style={{
                  padding: sp(10),
                  borderRadius: 12,
                  border: active
                    ? '1px solid rgba(96,165,250,0.7)'
                    : '1px solid rgba(51,65,85,0.9)',
                  background: active ? 'rgba(37,99,235,0.15)' : 'rgba(15,23,42,0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: sp(6),
                }}
              >
                <div style={{ fontSize: fs(14), fontWeight: 700, color: '#E2E8F0' }}>
                  {sc.id}. {sc.title}
                  {sc.fitsWindow ? (
                    <span style={{ marginLeft: 6, color: '#6EE7B7', fontWeight: 600, fontSize: fs(12) }}>
                      ок
                    </span>
                  ) : (
                    <span style={{ marginLeft: 6, color: '#FBBF24', fontWeight: 600, fontSize: fs(12) }}>
                      хвост {sc.uncoveredVolume.toFixed(1)} м³
                    </span>
                  )}
                </div>
                <div style={{ fontSize: fs(12), color: '#94A3B8', lineHeight: 1.35 }}>
                  {sc.summary}
                  {sc.nightHint ? ` ${sc.nightHint}` : ''}
                </div>
                <div style={{ fontSize: fs(12), color: '#64748B' }}>
                  {sc.mixerCount} микс. · {sc.tripCount} рейс.
                  {sc.orderShifts.length
                    ? ` · сдвигов ${sc.orderShifts.length}`
                    : ''}
                </div>
                <button
                  type="button"
                  onClick={() => applyScenario(sc)}
                  disabled={!canMutatePlan}
                  style={{
                    marginTop: 'auto',
                    alignSelf: 'flex-start',
                    padding: `${sp(6)}px ${sp(12)}px`,
                    borderRadius: 8,
                    border: 'none',
                    background: active ? '#3B82F6' : 'rgba(59,130,246,0.35)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: fs(13),
                    cursor: canEditPlan ? 'pointer' : 'default',
                    opacity: canEditPlan ? 1 : 0.5,
                  }}
                >
                  {active ? 'Выбран' : 'Выбрать'}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}


      {actionsColumn}
    </div>
  );
}

const linkBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#60A5FA',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '2px 6px',
};
