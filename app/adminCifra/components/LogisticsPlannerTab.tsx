'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Calculator,
  Layers,
  RefreshCw,
  Lock,
  Route,
  Database,
  Upload,
} from 'lucide-react';
import ModalActionButton from './ModalActionButton';
import PlannerTripFactRow from './PlannerTripFactRow';
import PlannerOperatorView from './PlannerOperatorView';
import OrderPlanProgressBar from './OrderPlanProgressBar';
import PlannerInsightsPanel from './PlannerInsightsPanel';
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
  isPickupOrder,
  liveShippedVolumeForOrder,
  nowMinutesIfDateKeyIsToday,
  orderProgressStatus,
  PICKUP_MIXER_NUMBER,
  PLANNER_FACT_SHIPPED_STATUSES,
  makePlannerWave,
  medianFactDelayMin,
  nextWaveStageIndex,
  parsePlanHhMm,
  planLogistics,
  rankFleetForDay,
  replanAfterManualTripShift,
  replanAfterTripDelay,
  resolvePlantOpenMinutes,
  type PlannedTrip,
  type PlannerMixer,
  type PlannerOrder,
  type PlannerOrderShift,
  type PlannerScenario,
  type PlannerWarning,
  type PlannerWave,
} from '@/lib/logisticsPlanner';
import {
  liveTripHasReleaseFact,
  matchAllPlanTripsToFact,
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
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { volumeCardStyle } from '../cardStyles';
import { useRealtimeProductionLogs } from '@/hooks/useRealtimeOrders';
import {
  useRealtimeDailyLogisticsPlan,
  type SharedLogisticsPlanRecord,
} from '@/hooks/useRealtimeDailyLogisticsPlan';
import { pluralRu, withSelectedMixersPhrase } from '@/lib/ruLocale';
import type { CSSProperties } from 'react';

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
  orderShifts?: PlannerOrderShift[];
  warnings?: PlannerWarning[];
  waves?: PlannerWave[];
};

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
    orderShifts: draft.orderShifts,
    warnings,
    waves: draft.waves,
  };
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
    orderShifts: Array.isArray(p.orderShifts) ? p.orderShifts : [],
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
    waves: Array.isArray(p.waves) ? p.waves : [],
  };
}

function actorDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('userName');
}

/** % выполнения плана заявки: отгруженный факт / объём заявки. */
function orderPlanPercent(
  orderVol: number,
  shipped: number,
  manualDone: boolean,
  statusDone: boolean,
): number {
  if (manualDone || statusDone) return 100;
  if (!(orderVol > 0)) return shipped > 0 ? 100 : 0;
  return Math.min(100, Math.round((shipped / orderVol) * 100));
}

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
  const runPlanRef = useRef<(mode: 'full_day' | 'stage') => Promise<void>>(
    async () => {},
  );
  const lastAutoStageDelayRef = useRef(0);
  const autoStageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStageReadyAtRef = useRef(0);
  const stickySyncRef = useRef(false);

  useEffect(() => {
    setCanEditPlan(canEditDailyLogisticsPlan(userRole));
  }, [userRole]);

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

  const planFactByTripId = useMemo(
    () => matchAllPlanTripsToFact(trips, dayTrips, dayProductionLogs),
    [trips, dayTrips, dayProductionLogs],
  );

  // Sticky 1:1: закрепить matchedTripId → orderMixerId на плановом рейсе
  useEffect(() => {
    if (stickySyncRef.current || !trips.length) return;
    let changed = false;
    const next = trips.map((t) => {
      const fact = planFactByTripId.get(t.id);
      if (!fact?.hasMatch || fact.matchedTripId == null) return t;
      if (t.orderMixerId === fact.matchedTripId) return t;
      changed = true;
      return { ...t, orderMixerId: fact.matchedTripId };
    });
    if (!changed) return;
    stickySyncRef.current = true;
    suppressPublishRef.current = true;
    setTrips(next);
    setLockedTrips((prev) =>
      prev.map((t) => {
        const fact = planFactByTripId.get(t.id);
        if (!fact?.matchedTripId || t.orderMixerId === fact.matchedTripId) return t;
        return { ...t, orderMixerId: fact.matchedTripId };
      }),
    );
    queueMicrotask(() => {
      stickySyncRef.current = false;
      suppressPublishRef.current = false;
    });
  }, [planFactByTripId, trips]);

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

  // Closed-loop: авто-этап при росте опоздания факта (без ручного «Рассчитать этап»)
  useEffect(() => {
    autoStageReadyAtRef.current = Date.now() + 45_000;
    lastAutoStageDelayRef.current = 0;
  }, [dateKey]);

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
      void runPlanRef.current('stage').finally(() => {
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
      const deliveryOrders = orders.filter((o) => !isPickupOrder(o.address));
      if (deliveryOrders.length === 0) {
        if (!opts?.silent) setRoadsNote('Самовывоз — дороги не считаю');
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
            batch: deliveryOrders.map((o) => ({
              orderId: o.id,
              address: o.address || '',
            })),
          }),
        });
        if (!res.ok) {
          setRoadsNote('Не удалось обновить дороги — считаю по старому кэшу');
          return;
        }
        const data = await res.json();
        const times = (data.times || {}) as Record<string, number>;
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
        const mins = Object.values(times);
        const avg =
          mins.length > 0
            ? Math.round(mins.reduce((s, n) => s + n, 0) / mins.length)
            : 0;
        setRoadsNote(
          `Дороги пересчитаны (формула v2): ${mins.length} заявок` +
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
          roadMin:
            localRoadTimes[String(o.id)] ??
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
          .map((m: any) => ({
            id: m.id,
            number: String(m.number || ''),
            volume: Number(m.volume) || 0,
            type: m.type === 'rented' ? 'rented' : 'own',
            unload_allowance_min: m.unload_allowance_min ?? null,
          }))
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

        if (draft?.selectedMixerIds?.length) {
          setSelectedIds(new Set(draft.selectedMixerIds));
        } else {
          setSelectedIds(
            new Set(rows.filter((r) => r.type === 'own').map((r) => String(r.id))),
          );
        }
        setLockedTrips(onlyToday(draft?.lockedTrips));
        setTrips(onlyToday(draft?.trips));
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
        setOrderShifts(Array.isArray(draft?.orderShifts) ? draft.orderShifts : []);
        setWaves(Array.isArray(draft?.waves) ? draft.waves : []);
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
              orderShifts: sharedPayload.orderShifts,
              warnings: sharedPayload.warnings,
              waves: sharedPayload.waves,
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
      const next = prev.filter((t) => dayOrderIds.has(String(t.orderId)));
      return next.length === prev.length ? prev : next;
    });
    setLockedTrips((prev) => {
      const next = prev.filter((t) => dayOrderIds.has(String(t.orderId)));
      return next.length === prev.length ? prev : next;
    });
  }, [orders, dateKey]);

  const plannerMixers: PlannerMixer[] = useMemo(() => {
    return fleet
      .filter((f) => selectedIds.has(String(f.id)))
      .map((f) => {
        const st = stats[f.number] || { tripCount: 0, volumeSum: 0 };
        return {
          id: f.id,
          number: f.number,
          volume: f.volume,
          type: f.type,
          unloadMin: f.unload_allowance_min,
          tripCount: st.tripCount,
          volumeSum: st.volumeSum,
        };
      });
  }, [fleet, selectedIds, stats]);

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
        };
      }),
    );
  }, [fleet, stats]);

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

  const persist = useCallback(
    (next: Partial<DraftState> & { trips?: PlannedTrip[]; lockedTrips?: PlannedTrip[] }) => {
      const draft: DraftState = {
        selectedMixerIds: [...selectedIds],
        lockedTrips: next.lockedTrips ?? lockedTrips,
        manualDoneOrderIds: [...manualDone],
        trips: next.trips ?? trips,
        allowNight: next.allowNight ?? allowNight,
        useTraffic: next.useTraffic ?? useTraffic,
        orderShifts: next.orderShifts ?? orderShifts,
        warnings: next.warnings ?? warningsRef.current,
        waves: next.waves ?? wavesRef.current,
      };
      if (next.selectedMixerIds) draft.selectedMixerIds = next.selectedMixerIds;
      draftSnapshotRef.current = draft;
      saveDraft(dateKey, draft);
      return draft;
    },
    [dateKey, selectedIds, lockedTrips, manualDone, trips, allowNight, useTraffic, orderShifts],
  );

  const applyRemotePlan = useCallback(
    (record: SharedLogisticsPlanRecord, opts?: { force?: boolean }) => {
      const rev = Number(record.revision) || 0;

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
      setLockedTrips(onlyToday(payload.lockedTrips));
      setTrips(onlyToday(payload.trips));
      setWarnings(payload.warnings || []);
      setManualDone(
        new Set(
          payload.manualDoneOrderIds.filter((id) => dayOrderIds.has(String(id))),
        ),
      );
      setAllowNight(Boolean(payload.allowNight));
      setUseTraffic(Boolean(payload.useTraffic));
      setOrderShifts(payload.orderShifts || []);
      setWaves(payload.waves || []);
      wavesRef.current = payload.waves || [];
      saveDraft(dateKey, {
        ...payload,
        lockedTrips: onlyToday(payload.lockedTrips),
        trips: onlyToday(payload.trips),
        waves: payload.waves || [],
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
          orderShifts,
          warnings: warningsRef.current,
          waves: wavesRef.current,
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

  useEffect(() => {
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
      if (autoStageTimerRef.current) clearTimeout(autoStageTimerRef.current);
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
    const stamped = nextTrips.map((t) =>
      newIds.includes(t.id) ? { ...t, waveId: wave.id } : t,
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
        orderShifts: opts?.orderShifts ?? orderShifts,
        warnings: nextWarnings,
        waves: nextWaves,
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

  const runPlan = async (mode: 'full_day' | 'stage') => {
    if (!canMutatePlan) return;
    setBusy(true);
    try {
      if (
        mode === 'full_day' &&
        (lockedTrips.length > 0 || trips.some((t) => t.locked || t.done))
      ) {
        const ok = await appConfirm(
          'Пересчитать весь день? Зафиксированные и отработанные рейсы будут сброшены. История волн начнётся заново с «Утро».',
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

      // Этап: не перетирать done/locked и рейсы с фактом выпуска оператора.
      let locked: PlannedTrip[] = [];
      if (mode === 'stage') {
        const factLocked = trips
          .filter((t) => {
            if (t.locked || t.done) return true;
            const fact = planFactByTripId.get(t.id);
            if (fact?.factRelease || fact?.noOperatorRecord) return true;
            if (
              fact?.matchedTripId != null &&
              (PLANNER_FACT_SHIPPED_STATUSES as readonly string[]).includes(
                String(fact.factStatus || ''),
              )
            ) {
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
          })
          .map((t) => {
            const fact = planFactByTripId.get(t.id);
            return {
              ...t,
              locked: true,
              done: t.done || Boolean(fact?.factRelease),
              // Чтобы planLogistics не вычел объём повторно после applyLiveFact
              orderMixerId:
                t.orderMixerId ?? fact?.matchedTripId ?? null,
            };
          });
        locked = [...lockedTrips, ...factLocked].filter(
          (t, i, arr) => arr.findIndex((x) => x.id === t.id) === i,
        );
      }

      // Пустой остаток ≠ «считай заново весь день»: иначе done/manualDone сбрасываются.
      if (ordersForPlan.length === 0) {
        await appAlert(
          'Нет заявок для расчёта — все уже отработаны или закрыты по факту.',
          { title: 'Расчёт', variant: 'warning' },
        );
        return;
      }

      const baseInput = {
        mode,
        orders: ordersForPlan,
        mixers: plannerMixers,
        lockedTrips: locked,
        doneOrderIds,
        allowNight,
        useTraffic,
        factDelayMin: delayFactMin || undefined,
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

      const { result, locked, shifted } = replanAfterManualTripShift({
        allTrips: trips,
        tripId,
        newLoadAtMin: newLoad,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: plannerMixers,
        doneOrderIds,
        allowNight,
        useTraffic,
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

      const { result, locked, shifted } = replanAfterTripDelay({
        allTrips: trips,
        tripId,
        delayMin: next,
        orders: plannerOrders.filter((o) => !manualDone.has(String(o.id))),
        mixers: plannerMixers,
        doneOrderIds,
        allowNight,
        useTraffic,
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

  const lockAllCurrent = () => {
    if (!canMutatePlan) return;
    setTrips((prev) => prev.map((t) => ({ ...t, locked: true })));
    setLockedTrips((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      for (const t of trips) map.set(t.id, { ...t, locked: true });
      return [...map.values()];
    });
  };

  const toggleOrderDone = (orderId: string) => {
    if (!canMutatePlan) return;
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
              return `—— ${w.label}${t ? ` (${t})` : ''} · ${w.newTripCount} рейс.${delay}${sum} ——`;
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
    try {
      await navigator.clipboard.writeText(body);
      await appAlert('План скопирован — можно вставить в Макс', {
        title: 'Готово',
        variant: 'success',
      });
    } catch {
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
    for (const t of trips) {
      const key = String(t.orderId);
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ka = a.loadAtMin ?? 0;
        const kb = b.loadAtMin ?? 0;
        if (ka || kb) return ka - kb;
        return String(a.loadTime).localeCompare(String(b.loadTime));
      });
    }
    return map;
  }, [trips]);

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
              return (
                <button
                  key={w.id}
                  type="button"
                  title={
                    `${w.label}` +
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
                  {w.label}
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
            maxHeight: isPageLayout ? (is4k ? sp(220) : sp(180)) : is4k ? sp(120) : sp(88),
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: sp(8),
          }}
        >
          {rankedAll.map((m) => {
            const id = String(m.id);
            const on = selectedIds.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleMixer(id)}
                disabled={!canMutatePlan}
                style={{
                  padding: `${sp(7)}px ${sp(11)}px`,
                  borderRadius: 10,
                  border: on
                    ? '1px solid rgba(16,185,129,0.55)'
                    : '1px solid rgba(51,65,85,0.9)',
                  background: on ? 'rgba(16,185,129,0.15)' : 'rgba(15,23,42,0.6)',
                  color: on ? '#A7F3D0' : '#94A3B8',
                  fontSize: fs(13),
                  fontWeight: 600,
                  cursor: canEditPlan ? 'pointer' : 'default',
                  opacity: canEditPlan ? 1 : 0.7,
                }}
                title={`${m.type === 'own' ? 'Свой' : 'Наёмный'} · рейсов в истории ${m.tripCount || 0}`}
              >
                {m.number} · {m.volume}м³
                {m.type === 'own' ? '' : ' ·Н'}
              </button>
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

  const actionsColumn = (
    <>
      {/* Кнопки расчёта + «Включая ночь» */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: sp(10),
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <ModalActionButton
          color="#34D399"
          icon={<Calculator size={fs(16)} />}
          label={busy ? 'Считаю…' : 'Рассчитать весь день'}
          size="lg"
          onClick={() => void runPlan('full_day')}
          disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
        />
        <ModalActionButton
          color="#60A5FA"
          icon={<Layers size={fs(16)} />}
          label="Рассчитать этап"
          size="lg"
          onClick={() => void runPlan('stage')}
          disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
        />
        <ModalActionButton
          color="#94A3B8"
          icon={<Lock size={fs(16)} />}
          label="Зафиксировать текущее"
          size="lg"
          onClick={lockAllCurrent}
          disabled={!canMutatePlan || !trips.length}
        />
        <ModalActionButton
          color="#F87171"
          icon={<RefreshCw size={fs(16)} />}
          label="Сбросить расчёт"
          size="lg"
          onClick={() => void resetPlan()}
          disabled={
            !canEditPlan ||
            (!trips.length && !lockedTrips.length && warnings.length === 0)
          }
        />
        <ModalActionButton
          color="#38BDF8"
          icon={<Route size={fs(16)} />}
          label={roadsRefreshing ? 'Дороги…' : 'Обновить дороги'}
          size="lg"
          onClick={() => void refreshRoadTimes()}
          disabled={roadsRefreshing || !orders.length}
        />
        <label
          title="Утро 7–9 и вечер 16–18: дорога чуть дольше (×1.25–1.35) к обычному времени в пути. Выкл — считаем без надбавки за пробки."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: sp(8),
            marginLeft: 'auto',
            color: '#CBD5E1',
            fontSize: fs(14),
            fontWeight: 600,
            cursor: canEditPlan ? 'pointer' : 'default',
            userSelect: 'none',
            opacity: canEditPlan ? 1 : 0.55,
          }}
        >
          <input
            type="checkbox"
            checked={useTraffic}
            disabled={!canMutatePlan}
            onChange={(e) => {
              setUseTraffic(e.target.checked);
              setScenarios([]);
              setActiveScenarioId(null);
            }}
            style={{ width: fs(16), height: fs(16), accentColor: '#38BDF8' }}
          />
          Учитывать пробки
        </label>
        <label
          title="Без галочки возврат на базу ≤ 21:00. Открытие соски сдвигается раньше 06:00, если есть ранние доставки (к 06:00 и т.п.). С галочкой — рейсы после 21:00 и на следующие сутки."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: sp(8),
            color: '#CBD5E1',
            fontSize: fs(14),
            fontWeight: 600,
            cursor: canEditPlan ? 'pointer' : 'default',
            userSelect: 'none',
            opacity: canEditPlan ? 1 : 0.55,
          }}
        >
          <input
            type="checkbox"
            checked={allowNight}
            disabled={!canMutatePlan}
            onChange={(e) => {
              setAllowNight(e.target.checked);
              setScenarios([]);
              setActiveScenarioId(null);
            }}
            style={{ width: fs(16), height: fs(16), accentColor: '#F59E0B' }}
          />
          Включая ночь
        </label>
      </div>
      {/* Липкий низ */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: sp(10),
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexShrink: 0,
          paddingTop: sp(10),
          borderTop: '1px solid rgba(51,65,85,0.9)',
        }}
      >
        <div
          style={{
            marginRight: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: sp(12),
          }}
        >
          <label
            title="Если включено — во списке заявок появляется вторая галочка (фиолетовая): применить план только к отмеченным. Иначе — ко всем заявкам с рейсами."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: sp(8),
              color: '#CBD5E1',
              fontSize: fs(13),
              fontWeight: 600,
              cursor: canEditPlan ? 'pointer' : 'default',
              userSelect: 'none',
              opacity: canEditPlan ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={applyOnlySelected}
              disabled={!canMutatePlan}
              onChange={(e) => setApplyOnlySelected(e.target.checked)}
              style={{ width: fs(16), height: fs(16), accentColor: '#A78BFA' }}
            />
            Только выбранные заявки
            {applyOnlySelected && applyableOrderIds.size > 0 ? (
              <span style={{ color: '#A78BFA', fontWeight: 700 }}>
                ({[...applyOrderIds].filter((id) => applyableOrderIds.has(id)).length}/
                {applyableOrderIds.size})
              </span>
            ) : null}
          </label>
          <label
            title="По умолчанию выкл: заявки, где диспетчер уже поставил миксеры («Загрузка»), интеллект не трогает. Включи только если сознательно хочешь заменить ручные назначения планом."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: sp(8),
              color: overwriteManual ? '#FCA5A5' : '#CBD5E1',
              fontSize: fs(13),
              fontWeight: 600,
              cursor: canEditPlan ? 'pointer' : 'default',
              userSelect: 'none',
              opacity: canEditPlan ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={overwriteManual}
              disabled={!canMutatePlan}
              onChange={(e) => setOverwriteManual(e.target.checked)}
              style={{ width: fs(16), height: fs(16), accentColor: '#F87171' }}
            />
            Заменить ручные «Загрузка»
          </label>
        </div>
        <ModalActionButton
          color={publishDirty ? '#A78BFA' : '#818CF8'}
          icon={<Upload size={fs(16)} />}
          label={
            publishing
              ? 'Публикую…'
              : publishDirty
                ? 'Опубликовать'
                : 'Опубликовано'
          }
          size="lg"
          onClick={() => void publishNow()}
          disabled={!canMutatePlan || publishing || (!publishDirty && !trips.length)}
        />
        <ModalActionButton
          color="#C084FC"
          icon={<Database size={fs(16)} />}
          label={applying ? 'Пишу…' : 'Применить в заявки'}
          size="lg"
          onClick={() => void applyToOrders()}
          disabled={!canMutatePlan || applying || applyableOrderIds.size === 0}
        />
        <ModalActionButton
          color="#34D399"
          icon={<Copy size={fs(16)} />}
          label="Скопировать план"
          size="lg"
          onClick={() => void copyPlan(false)}
          disabled={!trips.length}
        />
        <ModalActionButton
          color="#60A5FA"
          icon={<Copy size={fs(16)} />}
          label="Скопировать этап"
          size="lg"
          onClick={() => void copyPlan(true)}
          disabled={!trips.some((t) => !t.locked && !t.done)}
        />
        <ModalActionButton
          color="#A78BFA"
          icon={<Copy size={fs(16)} />}
          label="В Макс"
          size="lg"
          onClick={() => applyToMax(false)}
          disabled={!canMutatePlan || !trips.length}
        />
      </div>
    </>
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
          gap: sp(12),
        }}
      >
        <PlannerInsightsPanel
          dateKey={toApiDateKey(dateKey)}
          uiScale={uiScale}
          canEdit={canMutatePlan}
          recalculateBusy={busy}
          onRecalculate={() => void runPlan('full_day')}
        />

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
              minHeight: 0,
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
            display: 'flex',
            flexDirection: 'column',
            gap: sp(10),
            paddingRight: 4,
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
                <div key={oid} style={{ display: 'flex', flexDirection: 'column', gap: sp(5) }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: sp(8),
                      flexWrap: 'nowrap',
                      whiteSpace: 'nowrap',
                      padding:
                        st === 'done'
                          ? `${sp(3)}px ${sp(8)}px`
                          : `${sp(4)}px ${sp(8)}px`,
                      minHeight: st === 'done' ? sp(28) : sp(32),
                      borderRadius: 8,
                      background:
                        st === 'done'
                          ? 'linear-gradient(180deg, rgba(15,23,42,0.55) 0%, rgba(15,23,42,0.72) 100%)'
                          : 'linear-gradient(180deg, rgba(30,41,59,0.75) 0%, rgba(15,23,42,0.88) 100%)',
                      border: '1px solid rgba(148,163,184,0.2)',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.25)',
                      opacity: st === 'done' ? 0.7 : 1,
                      fontSize: fs(13),
                      lineHeight: 1.2,
                      color: '#E2E8F0',
                      outline:
                        applyOnlySelected && canApply && selectedForApply
                          ? '1px solid rgba(167,139,250,0.55)'
                          : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={manualDone.has(oid) || st === 'done'}
                      onChange={() => toggleOrderDone(oid)}
                      disabled={!canMutatePlan}
                      title="Пометить отработанной"
                      style={{
                        width: fs(16),
                        height: fs(16),
                        cursor: canEditPlan ? 'pointer' : 'default',
                      }}
                    />
                    {applyOnlySelected && canApply && canEditPlan ? (
                      <input
                        type="checkbox"
                        checked={selectedForApply}
                        onChange={() => toggleApplyOrder(oid)}
                        title="Включить в «Применить в заявки»"
                        style={{
                          width: fs(16),
                          height: fs(16),
                          accentColor: '#A78BFA',
                          cursor: 'pointer',
                        }}
                      />
                    ) : null}
                    <span style={{ fontWeight: 700, flexShrink: 0 }}>#{o.id}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.client}
                    </span>
                    {(() => {
                      const shipped = liveShippedVolumeForOrder(o.id, dayTrips);
                      const planVol = Number(o.volume) || 0;
                      const pct = orderPlanPercent(
                        planVol,
                        shipped,
                        manualDone.has(oid),
                        st === 'done',
                      );
                      return (
                        <OrderPlanProgressBar
                          percent={pct}
                          shipped={shipped}
                          planVol={planVol}
                          fs={fs}
                          sp={sp}
                        />
                      );
                    })()}
                    <span style={{ color: '#10B981', fontWeight: 700, flexShrink: 0 }}>{o.volume} м³</span>
                    <span style={{ color: '#94A3B8', flexShrink: 0 }}>{o.deliveryTime}</span>
                    {pickup ? (
                      <span
                        style={{
                          padding: `${sp(2)}px ${sp(8)}px`,
                          borderRadius: 999,
                          fontSize: fs(12),
                          fontWeight: 700,
                          background: 'rgba(251,146,60,0.18)',
                          color: '#FDBA74',
                          flexShrink: 0,
                        }}
                        title="Клиент забирает сам — в плане только соска"
                      >
                        самовывоз
                      </span>
                    ) : null}
                    <span
                      style={{
                        padding: `${sp(2)}px ${sp(8)}px`,
                        borderRadius: 999,
                        fontSize: fs(12),
                        fontWeight: 700,
                        background: badge.bg,
                        color: badge.color,
                        flexShrink: 0,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  {orderTrips.map((t) => {
                    const waveHighlight =
                      activeWaveId != null &&
                      waves.some(
                        (w) => w.id === activeWaveId && w.tripIds.includes(t.id),
                      );
                    return (
                      <div
                        key={t.id}
                        style={{
                          outline: waveHighlight
                            ? '1px solid rgba(96,165,250,0.55)'
                            : undefined,
                          borderRadius: 8,
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
                              deltaLoadMin: null,
                              deltaReleaseMin: null,
                              noOperatorRecord: false,
                              hasMatch: false,
                            }
                          }
                          fs={fs}
                          sp={sp}
                          busy={busy || applying}
                          canShiftPlan={canMutatePlan}
                          onShiftLoadTime={(id, hhmm) => void shiftTripLoad(id, hhmm)}
                          onTripDelayMin={(id, mins) => void applyTripDelay(id, mins)}
                        />
                      </div>
                    );
                  })}
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
            display: 'flex',
            flexDirection: 'column',
            gap: sp(8),
            padding: `${sp(12)}px ${sp(14)}px`,
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
              return (
                <button
                  key={w.id}
                  type="button"
                  title={
                    `${w.label}` +
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
                  {w.label}
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
            display: 'flex',
            flexDirection: 'column',
            gap: sp(10),
            paddingRight: 4,
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
                <div key={oid} style={{ display: 'flex', flexDirection: 'column', gap: sp(5) }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: sp(8),
                      flexWrap: 'nowrap',
                      whiteSpace: 'nowrap',
                      padding:
                        st === 'done'
                          ? `${sp(3)}px ${sp(8)}px`
                          : `${sp(4)}px ${sp(8)}px`,
                      minHeight: st === 'done' ? sp(28) : sp(32),
                      borderRadius: 8,
                      background:
                        st === 'done'
                          ? 'linear-gradient(180deg, rgba(15,23,42,0.55) 0%, rgba(15,23,42,0.72) 100%)'
                          : 'linear-gradient(180deg, rgba(30,41,59,0.75) 0%, rgba(15,23,42,0.88) 100%)',
                      border: '1px solid rgba(148,163,184,0.2)',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.25)',
                      opacity: st === 'done' ? 0.7 : 1,
                      fontSize: fs(13),
                      lineHeight: 1.2,
                      color: '#E2E8F0',
                      outline:
                        applyOnlySelected && canApply && selectedForApply
                          ? '1px solid rgba(167,139,250,0.55)'
                          : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={manualDone.has(oid) || st === 'done'}
                      onChange={() => toggleOrderDone(oid)}
                      disabled={!canMutatePlan}
                      title="Пометить отработанной"
                      style={{
                        width: fs(16),
                        height: fs(16),
                        cursor: canEditPlan ? 'pointer' : 'default',
                      }}
                    />
                    {applyOnlySelected && canApply && canEditPlan ? (
                      <input
                        type="checkbox"
                        checked={selectedForApply}
                        onChange={() => toggleApplyOrder(oid)}
                        title="Включить в «Применить в заявки»"
                        style={{
                          width: fs(16),
                          height: fs(16),
                          accentColor: '#A78BFA',
                          cursor: 'pointer',
                        }}
                      />
                    ) : null}
                    <span style={{ fontWeight: 700, flexShrink: 0 }}>#{o.id}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.client}
                    </span>
                    {(() => {
                      const shipped = liveShippedVolumeForOrder(o.id, dayTrips);
                      const planVol = Number(o.volume) || 0;
                      const pct = orderPlanPercent(
                        planVol,
                        shipped,
                        manualDone.has(oid),
                        st === 'done',
                      );
                      return (
                        <OrderPlanProgressBar
                          percent={pct}
                          shipped={shipped}
                          planVol={planVol}
                          fs={fs}
                          sp={sp}
                        />
                      );
                    })()}
                    <span style={{ color: '#10B981', fontWeight: 700, flexShrink: 0 }}>{o.volume} м³</span>
                    <span style={{ color: '#94A3B8', flexShrink: 0 }}>{o.deliveryTime}</span>
                    {pickup ? (
                      <span
                        style={{
                          padding: `${sp(2)}px ${sp(8)}px`,
                          borderRadius: 999,
                          fontSize: fs(12),
                          fontWeight: 700,
                          background: 'rgba(251,146,60,0.18)',
                          color: '#FDBA74',
                          flexShrink: 0,
                        }}
                        title="Клиент забирает сам — в плане только соска"
                      >
                        самовывоз
                      </span>
                    ) : null}
                    <span
                      style={{
                        padding: `${sp(2)}px ${sp(8)}px`,
                        borderRadius: 999,
                        fontSize: fs(12),
                        fontWeight: 700,
                        background: badge.bg,
                        color: badge.color,
                        flexShrink: 0,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  {orderTrips.map((t) => {
                    const waveHighlight =
                      activeWaveId != null &&
                      waves.some(
                        (w) => w.id === activeWaveId && w.tripIds.includes(t.id),
                      );
                    return (
                      <div
                        key={t.id}
                        style={{
                          outline: waveHighlight
                            ? '1px solid rgba(96,165,250,0.55)'
                            : undefined,
                          borderRadius: 8,
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
                              deltaLoadMin: null,
                              deltaReleaseMin: null,
                              noOperatorRecord: false,
                              hasMatch: false,
                            }
                          }
                          fs={fs}
                          sp={sp}
                          busy={busy || applying}
                          canShiftPlan={canMutatePlan}
                          onShiftLoadTime={(id, hhmm) => void shiftTripLoad(id, hhmm)}
                          onTripDelayMin={(id, mins) => void applyTripDelay(id, mins)}
                        />
                      </div>
                    );
                  })}
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
            maxHeight: isPageLayout ? (is4k ? sp(220) : sp(180)) : is4k ? sp(120) : sp(88),
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: sp(8),
          }}
        >
          {rankedAll.map((m) => {
            const id = String(m.id);
            const on = selectedIds.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleMixer(id)}
                disabled={!canMutatePlan}
                style={{
                  padding: `${sp(7)}px ${sp(11)}px`,
                  borderRadius: 10,
                  border: on
                    ? '1px solid rgba(16,185,129,0.55)'
                    : '1px solid rgba(51,65,85,0.9)',
                  background: on ? 'rgba(16,185,129,0.15)' : 'rgba(15,23,42,0.6)',
                  color: on ? '#A7F3D0' : '#94A3B8',
                  fontSize: fs(13),
                  fontWeight: 600,
                  cursor: canEditPlan ? 'pointer' : 'default',
                  opacity: canEditPlan ? 1 : 0.7,
                }}
                title={`${m.type === 'own' ? 'Свой' : 'Наёмный'} · рейсов в истории ${m.tripCount || 0}`}
              >
                {m.number} · {m.volume}м³
                {m.type === 'own' ? '' : ' ·Н'}
              </button>
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


      {/* Кнопки расчёта + «Включая ночь» */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: sp(10),
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        <ModalActionButton
          color="#34D399"
          icon={<Calculator size={fs(16)} />}
          label={busy ? 'Считаю…' : 'Рассчитать весь день'}
          size="lg"
          onClick={() => void runPlan('full_day')}
          disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
        />
        <ModalActionButton
          color="#60A5FA"
          icon={<Layers size={fs(16)} />}
          label="Рассчитать этап"
          size="lg"
          onClick={() => void runPlan('stage')}
          disabled={!canMutatePlan || busy || loadingFleet || roadsRefreshing}
        />
        <ModalActionButton
          color="#94A3B8"
          icon={<Lock size={fs(16)} />}
          label="Зафиксировать текущее"
          size="lg"
          onClick={lockAllCurrent}
          disabled={!canMutatePlan || !trips.length}
        />
        <ModalActionButton
          color="#F87171"
          icon={<RefreshCw size={fs(16)} />}
          label="Сбросить расчёт"
          size="lg"
          onClick={() => void resetPlan()}
          disabled={
            !canEditPlan ||
            (!trips.length && !lockedTrips.length && warnings.length === 0)
          }
        />
        <ModalActionButton
          color="#38BDF8"
          icon={<Route size={fs(16)} />}
          label={roadsRefreshing ? 'Дороги…' : 'Обновить дороги'}
          size="lg"
          onClick={() => void refreshRoadTimes()}
          disabled={roadsRefreshing || !orders.length}
        />
        <label
          title="Утро 7–9 и вечер 16–18: дорога чуть дольше (×1.25–1.35) к обычному времени в пути. Выкл — считаем без надбавки за пробки."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: sp(8),
            marginLeft: 'auto',
            color: '#CBD5E1',
            fontSize: fs(14),
            fontWeight: 600,
            cursor: canEditPlan ? 'pointer' : 'default',
            userSelect: 'none',
            opacity: canEditPlan ? 1 : 0.55,
          }}
        >
          <input
            type="checkbox"
            checked={useTraffic}
            disabled={!canMutatePlan}
            onChange={(e) => {
              setUseTraffic(e.target.checked);
              setScenarios([]);
              setActiveScenarioId(null);
            }}
            style={{ width: fs(16), height: fs(16), accentColor: '#38BDF8' }}
          />
          Учитывать пробки
        </label>
        <label
          title="Без галочки возврат на базу ≤ 21:00. Открытие соски сдвигается раньше 06:00, если есть ранние доставки (к 06:00 и т.п.). С галочкой — рейсы после 21:00 и на следующие сутки."
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: sp(8),
            color: '#CBD5E1',
            fontSize: fs(14),
            fontWeight: 600,
            cursor: canEditPlan ? 'pointer' : 'default',
            userSelect: 'none',
            opacity: canEditPlan ? 1 : 0.55,
          }}
        >
          <input
            type="checkbox"
            checked={allowNight}
            disabled={!canMutatePlan}
            onChange={(e) => {
              setAllowNight(e.target.checked);
              setScenarios([]);
              setActiveScenarioId(null);
            }}
            style={{ width: fs(16), height: fs(16), accentColor: '#F59E0B' }}
          />
          Включая ночь
        </label>
      </div>


      {/* Липкий низ */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: sp(10),
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexShrink: 0,
          paddingTop: sp(10),
          borderTop: '1px solid rgba(51,65,85,0.9)',
        }}
      >
        <div
          style={{
            marginRight: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: sp(12),
          }}
        >
          <label
            title="Если включено — во списке заявок появляется вторая галочка (фиолетовая): применить план только к отмеченным. Иначе — ко всем заявкам с рейсами."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: sp(8),
              color: '#CBD5E1',
              fontSize: fs(13),
              fontWeight: 600,
              cursor: canEditPlan ? 'pointer' : 'default',
              userSelect: 'none',
              opacity: canEditPlan ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={applyOnlySelected}
              disabled={!canMutatePlan}
              onChange={(e) => setApplyOnlySelected(e.target.checked)}
              style={{ width: fs(16), height: fs(16), accentColor: '#A78BFA' }}
            />
            Только выбранные заявки
            {applyOnlySelected && applyableOrderIds.size > 0 ? (
              <span style={{ color: '#A78BFA', fontWeight: 700 }}>
                ({[...applyOrderIds].filter((id) => applyableOrderIds.has(id)).length}/
                {applyableOrderIds.size})
              </span>
            ) : null}
          </label>
          <label
            title="По умолчанию выкл: заявки, где диспетчер уже поставил миксеры («Загрузка»), интеллект не трогает. Включи только если сознательно хочешь заменить ручные назначения планом."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: sp(8),
              color: overwriteManual ? '#FCA5A5' : '#CBD5E1',
              fontSize: fs(13),
              fontWeight: 600,
              cursor: canEditPlan ? 'pointer' : 'default',
              userSelect: 'none',
              opacity: canEditPlan ? 1 : 0.55,
            }}
          >
            <input
              type="checkbox"
              checked={overwriteManual}
              disabled={!canMutatePlan}
              onChange={(e) => setOverwriteManual(e.target.checked)}
              style={{ width: fs(16), height: fs(16), accentColor: '#F87171' }}
            />
            Заменить ручные «Загрузка»
          </label>
        </div>
        <ModalActionButton
          color={publishDirty ? '#A78BFA' : '#818CF8'}
          icon={<Upload size={fs(16)} />}
          label={
            publishing
              ? 'Публикую…'
              : publishDirty
                ? 'Опубликовать'
                : 'Опубликовано'
          }
          size="lg"
          onClick={() => void publishNow()}
          disabled={!canMutatePlan || publishing || (!publishDirty && !trips.length)}
        />
        <ModalActionButton
          color="#C084FC"
          icon={<Database size={fs(16)} />}
          label={applying ? 'Пишу…' : 'Применить в заявки'}
          size="lg"
          onClick={() => void applyToOrders()}
          disabled={!canMutatePlan || applying || applyableOrderIds.size === 0}
        />
        <ModalActionButton
          color="#34D399"
          icon={<Copy size={fs(16)} />}
          label="Скопировать план"
          size="lg"
          onClick={() => void copyPlan(false)}
          disabled={!trips.length}
        />
        <ModalActionButton
          color="#60A5FA"
          icon={<Copy size={fs(16)} />}
          label="Скопировать этап"
          size="lg"
          onClick={() => void copyPlan(true)}
          disabled={!trips.some((t) => !t.locked && !t.done)}
        />
        <ModalActionButton
          color="#A78BFA"
          icon={<Copy size={fs(16)} />}
          label="В Макс"
          size="lg"
          onClick={() => applyToMax(false)}
          disabled={!canMutatePlan || !trips.length}
        />
      </div>
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
