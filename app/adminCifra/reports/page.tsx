'use client';

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell 
} from 'recharts';
import { findRecipeByGrade, getAdditiveDosage, type RecipeLike } from '@/lib/recipeAdditives';
import { CARD_BORDER, modalCloseButtonStyle, modalFieldStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import ModalDateInput from '../components/ModalDateInput';
import { appConfirm } from '../components/appDialog';

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// Кеш данных между переключениями вкладок — не нужно рефетчить каждый раз
let _historyCache: any[] | null = null;

// Кеш рецептов для нормы добавок (сверка без склада)
let _recipesCache: RecipeLike[] | null = null;

// Кеш факта по маркам из production_logs (кнопка «Сверка» / модалка)
const _gradesActualCache = new Map<string, { grade: string; volumeM3: number }[]>();

/** Порог итогового расхождения объёма по маркам (план MEKA vs факт отгрузки), %. */
const RECONCILE_VOLUME_ALERT_PERCENT = 0.5;

/** Объём м³: округление до 1 знака; целые без «,0» (10 → «10», 9.8 → «9,8»). */
function formatVolumeM3(value: number | null | undefined): string {
  const n = Number(value) || 0;
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

async function loadRecipesForReconcile(): Promise<RecipeLike[]> {
  if (_recipesCache) return _recipesCache;
  const res = await fetch('/api/adminCifra/recipes', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Рецепты: HTTP ${res.status}`);
  const data = await res.json();
  _recipesCache = Array.isArray(data) ? data : [];
  return _recipesCache;
}

/** Дата отчёта в YYYY-MM-DD — из report_date или первой строки raw_data (ДД.ММ.ГГГГ). */
function getReportDateIso(report: any): string | null {
  const raw = report?.report_date || report?.raw_data?.[0]?.date || '';
  if (!raw) return null;
  if (raw.includes('.')) {
    const [day, month, year] = String(raw).split('.');
    if (!day || !month || !year) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Уже YYYY-MM-DD (или ISO с временем)
  return String(raw).substring(0, 10);
}

/**
 * Расход добавок по отчёту MEKA (кг) — колонки «Добавка 1 ПФМ» / «Добавка 2 Линомикс».
 * Склад и ручные операции не участвуют.
 */
function getMekaPlantAdditives(rawData: any[] | null | undefined) {
  const rows = Array.isArray(rawData) ? rawData : [];
  const pfmKg = rows.reduce((sum, r) => sum + (Number(r.additive) || 0), 0);
  const linomixKg = rows.reduce((sum, r) => sum + (Number(r.additive2) || 0), 0);
  return {
    pfmKg: Math.round(pfmKg * 10) / 10,
    linomixKg: Math.round(linomixKg * 10) / 10,
  };
}

/**
 * Норма добавок (кг) по отгрузкам завода: объём марки × дозировка рецепта.
 * Пример: м300 10 м³ × 3.8 кг/м³ = 38 кг.
 * Объёмы — из отгрузок (production_logs), как у сверки марок; не из MEKA qty.
 */
function getNormativeAdditivesFromShipments(
  shipments: { grade: string; volumeM3: number }[],
  recipes: RecipeLike[]
) {
  let pfmKg = 0;
  let linomixKg = 0;
  (Array.isArray(shipments) ? shipments : []).forEach((row) => {
    const volumeM3 = Number(row?.volumeM3) || 0;
    if (volumeM3 <= 0) return;
    const recipe = findRecipeByGrade(recipes, row?.grade);
    const dosage = getAdditiveDosage(recipe);
    if (!dosage) return;
    const kg = volumeM3 * dosage.kgPerM3;
    if (dosage.additiveId === 1) pfmKg += kg;
    else if (dosage.additiveId === 2) linomixKg += kg;
  });
  return {
    pfmKg: Math.round(pfmKg * 10) / 10,
    linomixKg: Math.round(linomixKg * 10) / 10,
  };
}

/** Нормализация марки/рецепта для сопоставления MEKA ↔ приложение. */
function normalizeGradeKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, '')
    .replace(/M(?=\d)/g, 'М'); // латинская M перед цифрой → кириллическая М
}

/** План по маркам (м³) из строк отчёта MEKA: recipe → Σ qty. */
function getPlanGrades(rawData: any[] | null | undefined): { grade: string; volumeM3: number }[] {
  const groups = new Map<string, { grade: string; volumeM3: number }>();
  (Array.isArray(rawData) ? rawData : []).forEach((row: any) => {
    const recipe = String(row?.recipe || '').trim();
    if (!recipe || recipe === 'Неизвестно' || recipe.includes('ИТОГО')) return;
    const key = normalizeGradeKey(recipe);
    if (!key) return;
    const prev = groups.get(key);
    const qty = Number(row.qty) || 0;
    if (prev) prev.volumeM3 += qty;
    else groups.set(key, { grade: recipe, volumeM3: qty });
  });
  return Array.from(groups.values()).map((g) => ({
    grade: g.grade,
    volumeM3: Math.round(g.volumeM3 * 10) / 10,
  }));
}

/** Факт по маркам (м³) из production_logs (+ осиротевшие рейсы). */
function getActualGradesFromLogs(logs: any[]): { grade: string; volumeM3: number }[] {
  const groups = new Map<string, { grade: string; volumeM3: number }>();
  (Array.isArray(logs) ? logs : []).forEach((log: any) => {
    const grade = String(log?.concrete_grade || '').trim() || '—';
    const key = normalizeGradeKey(grade);
    if (!key) return;
    const prev = groups.get(key);
    const vol = Number(log.volume) || 0;
    if (prev) prev.volumeM3 += vol;
    else groups.set(key, { grade, volumeM3: vol });
  });
  return Array.from(groups.values()).map((g) => ({
    grade: g.grade,
    volumeM3: Math.round(g.volumeM3 * 10) / 10,
  }));
}

/**
 * Сводит план (MEKA recipe) и факт (concrete_grade) в общие строки.
 * Сопоставление: точный ключ → без хвостового «И» → вхождение одной строки в другую.
 */
function mergeGradeRows(
  plan: { grade: string; volumeM3: number }[],
  actual: { grade: string; volumeM3: number }[]
): { grade: string; planM3: number; actualM3: number }[] {
  const actualByKey = new Map(
    actual.map((a) => [normalizeGradeKey(a.grade), { ...a }])
  );
  const usedActual = new Set<string>();

  const findActualKey = (planKey: string): string | null => {
    if (actualByKey.has(planKey)) return planKey;
    const withoutI = planKey.replace(/И$/, '');
    if (withoutI && actualByKey.has(withoutI)) return withoutI;
    if (withoutI) {
      for (const key of actualByKey.keys()) {
        if (key.replace(/И$/, '') === withoutI) return key;
      }
    }
    for (const key of actualByKey.keys()) {
      if (key.includes(planKey) || planKey.includes(key)) return key;
    }
    return null;
  };

  const rows: { grade: string; planM3: number; actualM3: number }[] = [];

  plan.forEach((p) => {
    const planKey = normalizeGradeKey(p.grade);
    const actualKey = findActualKey(planKey);
    let actualM3 = 0;
    if (actualKey && !usedActual.has(actualKey)) {
      actualM3 = actualByKey.get(actualKey)?.volumeM3 ?? 0;
      usedActual.add(actualKey);
    }
    rows.push({ grade: p.grade, planM3: p.volumeM3, actualM3 });
  });

  actual.forEach((a) => {
    const key = normalizeGradeKey(a.grade);
    if (usedActual.has(key)) return;
    rows.push({ grade: a.grade, planM3: 0, actualM3: a.volumeM3 });
  });

  return rows.sort((a, b) => (b.planM3 + b.actualM3) - (a.planM3 + a.actualM3));
}

/**
 * Итоговое расхождение объёма, %: |факт − план| / план × 100.
 * При plan ≤ 0: 0 если факта нет, иначе Infinity (считаем алертом).
 */
function getVolumeDeltaPercent(planM3: number, actualM3: number): number {
  if (planM3 <= 0) return actualM3 > 0 ? Infinity : 0;
  return (Math.abs(actualM3 - planM3) / planM3) * 100;
}

function isVolumeOverAlertThreshold(planM3: number, actualM3: number): boolean {
  return getVolumeDeltaPercent(planM3, actualM3) > RECONCILE_VOLUME_ALERT_PERCENT;
}

type VolumeAlertInfo = {
  over: boolean;
  percent: number;
  planM3: number;
  actualM3: number;
};

async function fetchGradesActualForDate(dateIso: string): Promise<{ grade: string; volumeM3: number }[]> {
  const cached = _gradesActualCache.get(dateIso);
  if (cached) return cached;

  const res = await fetch(`/api/adminCifra/production-log?date=${dateIso}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Отгрузка: HTTP ${res.status}`);
  const logs = await res.json();
  const gradesActual = getActualGradesFromLogs(Array.isArray(logs) ? logs : []);
  _gradesActualCache.set(dateIso, gradesActual);
  return gradesActual;
}

function computeVolumeAlert(
  rawData: any[] | null | undefined,
  gradesActual: { grade: string; volumeM3: number }[]
): VolumeAlertInfo {
  const planM3 = getPlanGrades(rawData).reduce((s, g) => s + g.volumeM3, 0);
  const actualM3 = gradesActual.reduce((s, g) => s + g.volumeM3, 0);
  const percent = getVolumeDeltaPercent(planM3, actualM3);
  return {
    over: isVolumeOverAlertThreshold(planM3, actualM3),
    percent: Number.isFinite(percent) ? Math.round(percent * 100) / 100 : percent,
    planM3: Math.round(planM3 * 10) / 10,
    actualM3: Math.round(actualM3 * 10) / 10,
  };
}

type ReconcileModalState = {
  dateIso: string;
  dateLabel: string;
  fileName: string;
  plan: { pfmKg: number; linomixKg: number };
  actual: { pfmKg: number; linomixKg: number } | null;
  trips: number | null;
  grades: { grade: string; planM3: number; actualM3: number }[];
  loading: boolean;
  error: string | null;
};

// Вызывается из operator/page.tsx при его монтировании — загружает данные фоново,
// пока пользователь ещё смотрит на вкладку «Заявки». К моменту клика на «Отчёты»
// данные уже в кеше и диаграмма появляется мгновенно без скелетона.
export async function preloadReportsData(): Promise<void> {
  if (_historyCache) return;
  try {
    const res = await fetch('/api/adminCifra/meka-report');
    if (res.ok) {
      _historyCache = await res.json();
    }
  } catch {
    // некритично — при первом заходе просто покажем скелетон
  }
}

/** Быстрые периоды для фильтра истории / статистики. */
type PeriodPreset = 'month' | 'last_month' | 'week' | 'days30' | 'year' | 'last_year' | 'all' | 'custom';

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getPeriodRange(preset: Exclude<PeriodPreset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (preset) {
    case 'month': {
      const lastDay = new Date(y, m + 1, 0).getDate();
      return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
    }
    case 'last_month': {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      const lastDay = new Date(ly, lm + 1, 0).getDate();
      return { from: `${ly}-${pad(lm + 1)}-01`, to: `${ly}-${pad(lm + 1)}-${pad(lastDay)}` };
    }
    case 'week': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toIsoDate(from), to: toIsoDate(now) };
    }
    case 'days30': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toIsoDate(from), to: toIsoDate(now) };
    }
    case 'year':
      return { from: `${y}-01-01`, to: toIsoDate(now) };
    case 'last_year': {
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from: toIsoDate(from), to: toIsoDate(now) };
    }
    case 'all':
      return { from: '', to: '' };
  }
}

const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'month', label: 'Этот месяц' },
  { key: 'last_month', label: 'Прошлый месяц' },
  { key: 'week', label: '7 дней' },
  { key: 'days30', label: '30 дней' },
  { key: 'year', label: 'Этот год' },
  { key: 'last_year', label: '12 месяцев' },
  { key: 'all', label: 'Всё время' },
  { key: 'custom', label: 'Период' },
];

function formatRuDateShort(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

export default function ReportsPage() {
  const [history, setHistory] = useState<any[]>(_historyCache || []);
  const [isLoading, setIsLoading] = useState(!_historyCache);
  const [reportData, setReportData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  // По умолчанию — текущий месяц (статистика и список сразу за месяц, не за всё время)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month');
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('month').from);
  const [dateTo, setDateTo] = useState(() => getPeriodRange('month').to);
  const [viewMode, setViewMode] = useState<'month' | 'day'>('day');
  const [currentPage, setCurrentPage] = useState(1);
  const [scaleMode, setScaleMode] = useState<'linear' | 'log'>('linear');

  const applyPeriodPreset = (preset: PeriodPreset) => {
    setPeriodPreset(preset);
    setCurrentPage(1);
    if (preset === 'custom') {
      // Если дат ещё нет — подставляем текущий месяц как стартовую рамку для правки
      if (!dateFrom && !dateTo) {
        const range = getPeriodRange('month');
        setDateFrom(range.from);
        setDateTo(range.to);
      }
      return;
    }
    const range = getPeriodRange(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  // Список загруженных отчётов не скроллится — вместо этого подстраиваем
  // количество строк на странице под реально доступную высоту (адаптивно
  // под 4K/1920/меньшие экраны), измеряя контейнер списка через ResizeObserver.
  const historyListRef = useRef<HTMLDivElement>(null);
  const [itemsPerPage, setItemsPerPage] = useState(8);

  // Recharts <ResponsiveContainer> ДО первого измерения родителя (через
  // ResizeObserver) держит служебные значения width/height = -1 — и именно в
  // этот момент, на самом первом рендере, печатает предупреждение "width(-1)
  // and height(-1) of chart should be greater than 0..." — это баг самого
  // Recharts (recharts/recharts#6716), возникает всегда при монтировании
  // компонента независимо от готовности раскладки страницы, поэтому просто
  // "подождать кадр" перед рендером не помогает. Официальный обходной путь —
  // передать `initialDimension`, тогда на первом рендере используются эти
  // значения вместо -1, и предупреждение не возникает. Сам график всё равно
  // корректно пересчитается на реальный размер сразу после измерения.
  const CHART_INITIAL_DIMENSION = { width: 400, height: 300 };

  // Подбираем itemsPerPage напрямую по ФАКТИЧЕСКИ отрендеренной высоте одной
  // строки — так учитывается зум браузера, масштабирование экрана (DPI),
  // суб-пиксельное округление шрифта (высота строки зависит от font-size:
  // clamp(12px, 0.9vw, 15px)) и другие факторы, из-за которых "теоретическая"
  // высота строки могла бы немного промахнуться.
  //
  // ВАЖНО: раньше здесь был пошаговый алгоритм (+1/-1 строка за раз, ждём
  // следующий resize/mutation, повторяем) — он ломался при большом скачке
  // доступной высоты (напр. смена монитора 4K → 1920 за один проход): чтобы
  // дойти от 24 строк до 6, нужно было 18 срабатываний ResizeObserver подряд,
  // и если что-то мешало кому-то из промежуточных шагов, итог "застревал" на
  // промежуточном значении — лишняя строка обрезалась по высоте. Формула ниже
  // вычисляет целевое количество строк ЗА ОДИН проход по реальному размеру,
  // поэтому не зависит от количества и порядка сработавших событий.
  //
  // КРИТИЧНО: высоту строки берём через getComputedStyle(...).height, а НЕ
  // getBoundingClientRect(). Весь /adminCifra обёрнут в transform: scale(...)
  // (layout.tsx, "ГЛОБАЛЬНЫЙ МАСШТАБ" — 1.00/0.88/0.84/0.80 в зависимости от
  // эффективной ширины окна, которая на реальном "1920" ноутбуке может
  // отличаться от 1920 из-за масштабирования Windows, что незаметно на глаз,
  // но сдвигает scale на ступеньку). getBoundingClientRect() возвращает
  // ВИЗУАЛЬНЫЙ размер ПОСЛЕ transform (т.е. уже умноженный на scale), а
  // el.clientHeight контейнера — размер ДО transform (сырые layout-координаты,
  // transform их не меняет). Делить одно на другое при scale ≠ 1.00 — это
  // делить в разных единицах, из-за чего расчёт "сколько строк влезает"
  // промахивался именно на экранах не с "чистым" 1920 (где scale случайно
  // равен 1.00), а с любым другим эффективным разрешением.
  // getComputedStyle(...).height, в отличие от getBoundingClientRect, transform
  // игнорирует (та же "сырая" система координат, что и clientHeight) — но, в
  // отличие от offsetHeight, сохраняет дробные суб-пиксели (offsetHeight
  // округляет до целого, а на грани буквально 1px этого достаточно, чтобы
  // недосчитать строку, которая на самом деле помещается).
  useEffect(() => {
    const el = historyListRef.current;
    if (!el) return;
    const GAP = 5;
    const adjust = () => {
      if (el.clientHeight <= 0) return;
      const rows = Array.from(el.children) as HTMLElement[];
      if (rows.length === 0) return;
      // Плейсхолдер "отчёты не найдены" совсем другой формы (крупный паддинг),
      // мерить по нему высоту обычной строки нельзя — иначе на пустой выборке
      // itemsPerPage резко проседает.
      if (rows.length === 1 && rows[0].dataset.reportPlaceholder === 'true') return;

      // box-sizing здесь content-box (нет Tailwind preflight) — cs.height не
      // включает padding/border, поэтому досчитываем их явно, чтобы получить
      // полную (border-box) высоту строки с сохранением суб-пиксельной точности.
      const cs = getComputedStyle(rows[0]);
      const rowHeight = parseFloat(cs.height)
        + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
        + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      if (!rowHeight || rowHeight <= 0) return;

      const target = Math.max(1, Math.floor((el.clientHeight + GAP) / (rowHeight + GAP)));
      setItemsPerPage(prev => (prev === target ? prev : target));
    };
    adjust();
    const ro = new ResizeObserver(adjust);
    ro.observe(el);
    const mo = new MutationObserver(adjust);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [itemsPerPage]);

  // ==================== ФИЛЬТР ПО РЕЦЕПТАМ В ТЕКУЩЕМ ОТЧЁТЕ (как в Excel) ====================
  // null = фильтр не применён (показываем все строки, все чекбоксы отмечены).
  // Set (даже пустой) = пользователь явно что-то выбрал/снял.
  const [selectedRecipes, setSelectedRecipes] = useState<Set<string> | null>(null);
  const [recipeFilterOpen, setRecipeFilterOpen] = useState(false);
  const [recipeFilterSearch, setRecipeFilterSearch] = useState('');
  // Координаты списка фильтра считаем от кнопки и рисуем через position:fixed —
  // иначе список зависит от высоты <table>, а <table>/её обёртка держат
  // overflow:hidden (нужно для другого фикса скролла) и "режут" список, когда
  // строк становится мало (например, после "Снять все" таблица сжимается почти
  // до высоты одного заголовка).
  const [recipeFilterPos, setRecipeFilterPos] = useState({ top: 0, left: 0 });
  // У модалки задан transform (центрирование) — по спецификации CSS это делает
  // её "системой координат" для всех потомков с position:fixed (top/left
  // считаются от НЕЁ, а не от экрана). getBoundingClientRect() кнопки всегда
  // возвращает координаты относительно ЭКРАНА, поэтому координаты обязательно
  // нужно пересчитывать относительно модалки — иначе на широких экранах (где
  // модалка сильно смещена от левого края) список фильтра "убегает" вправо на
  // величину этого смещения.
  const modalPanelRef = useRef<HTMLDivElement>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  // Метаданные отчёта, открытого в модалке (для заголовка) — сами строки лежат в reportData
  const [openReportMeta, setOpenReportMeta] = useState<{ fileName: string; dateLabel: string } | null>(null);

  // Сверка: добавки (норма по рецепту vs завод MEKA) + марки (MEKA vs отгрузка)
  const [reconcileModal, setReconcileModal] = useState<ReconcileModalState | null>(null);
  const [reconcileLoadingId, setReconcileLoadingId] = useState<string | number | null>(null);
  // Индикатор на кнопке «Сверка»: итоговое расхождение объёма по маркам > 0.5%
  const [volumeAlerts, setVolumeAlerts] = useState<Record<string, VolumeAlertInfo>>({});
  const volumeAlertCheckedRef = useRef<Set<string>>(new Set());

  const closeReportModal = () => {
    setReportData([]);
    setOpenReportMeta(null);
    setSelectedRecipes(null);
    setRecipeFilterOpen(false);
  };

  const openReconcileForReport = async (report: any) => {
    const dateIso = getReportDateIso(report);
    if (!dateIso) {
      alert('Не удалось определить дату отчёта для сверки');
      return;
    }

    const excelDate = report.raw_data?.[0]?.date || report.report_date || dateIso;
    const planGrades = getPlanGrades(report.raw_data);
    // Факт добавок — сразу из MEKA (завод). Склад/ручные списания не трогаем.
    const plantAdditives = getMekaPlantAdditives(report.raw_data);
    const mekaBatches = Array.isArray(report.raw_data) ? report.raw_data.length : 0;

    setReconcileLoadingId(report.id);
    setReconcileModal({
      dateIso,
      dateLabel: excelDate,
      fileName: report.file_name || '',
      plan: { pfmKg: 0, linomixKg: 0 },
      actual: plantAdditives,
      trips: mekaBatches,
      grades: planGrades.map((g) => ({ grade: g.grade, planM3: g.volumeM3, actualM3: 0 })),
      loading: true,
      error: null,
    });

    try {
      const [recipes, gradesActual] = await Promise.all([
        loadRecipesForReconcile(),
        fetchGradesActualForDate(dateIso),
      ]);

      // Добавки: MEKA (колонки ПФМ/Линомикс) vs отгрузки × рецепт — как у марок
      const plan = getNormativeAdditivesFromShipments(gradesActual, recipes);
      const grades = mergeGradeRows(planGrades, gradesActual);
      const volumeAlert = computeVolumeAlert(report.raw_data, gradesActual);
      volumeAlertCheckedRef.current.add(String(report.id));
      setVolumeAlerts((prev) => ({ ...prev, [String(report.id)]: volumeAlert }));

      setReconcileModal((prev) => prev ? {
        ...prev,
        plan,
        actual: plantAdditives,
        trips: mekaBatches,
        grades,
        loading: false,
      } : prev);
    } catch (err) {
      console.error('Не удалось получить сверку:', err);
      setReconcileModal((prev) => prev ? {
        ...prev,
        loading: false,
        error: 'Не удалось загрузить норму по рецептам / отгрузку',
      } : prev);
    } finally {
      setReconcileLoadingId(null);
    }
  };

  // Закрытие модалки детального отчёта по Escape
  useEffect(() => {
    if (reportData.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReportModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reportData.length]);

  // Закрытие модалки сверки по Escape
  useEffect(() => {
    if (!reconcileModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReconcileModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reconcileModal]);

  const loadHistory = async (force = false) => {
    // Если данные уже есть в кеше и не форс — показываем мгновенно
    if (_historyCache && !force) {
      setHistory(_historyCache);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/adminCifra/meka-report');
      if (res.ok) {
        const data = await res.json();
        _historyCache = data;
        // Новая история — пересчитаем индикаторы на кнопках «Сверка»
        volumeAlertCheckedRef.current.clear();
        setVolumeAlerts({});
        setHistory(data);
        setCurrentPage(1);
      } else {
        console.error('Ошибка загрузки отчётов');
      }
    } catch (err) {
      console.error('Ошибка fetch:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

    // ==================== ОПРЕДЕЛЕНИЕ РОЛИ ====================
  const [userRole, setUserRole] = useState<string>('manager');

  useEffect(() => {
    const savedRole = localStorage.getItem('userRole');
    if (savedRole) {
      setUserRole(savedRole);
    } else {
      // Запрос к серверу (как в layout и дашборде)
      fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: localStorage.getItem('userId') 
        }),
      })
        .then(res => res.json())
        .then(data => {
          const role = data.role || 'manager';
          setUserRole(role);
          localStorage.setItem('userRole', role);
        })
        .catch(() => setUserRole('manager'));
    }
  }, []);

  // ==================== ФИЛЬТРАЦИЯ И ПАГИНАЦИЯ ====================
  const filteredHistory = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return history.filter(report => {
      const reportDateStr = getReportDateIso(report) || '';
      const excelDate = report.raw_data?.[0]?.date || report.report_date || '';

      const matchesSearch = !q ||
        String(report.file_name || '').toLowerCase().includes(q) ||
        String(excelDate).toLowerCase().includes(q) ||
        reportDateStr.includes(q);

      let matchesDate = true;
      if (dateFrom) matchesDate = matchesDate && reportDateStr >= dateFrom;
      if (dateTo) matchesDate = matchesDate && reportDateStr <= dateTo;

      return matchesSearch && matchesDate;
    });
  }, [history, searchTerm, dateFrom, dateTo]);

  const periodLabel = useMemo(() => {
    switch (periodPreset) {
      case 'month':
        return new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      case 'last_month': {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      }
      case 'week': return 'последние 7 дней';
      case 'days30': return 'последние 30 дней';
      case 'year': return `год ${new Date().getFullYear()}`;
      case 'last_year': return 'последние 12 месяцев';
      case 'all': return 'всё время';
      case 'custom':
        if (dateFrom && dateTo) return `${formatRuDateShort(dateFrom)} — ${formatRuDateShort(dateTo)}`;
        if (dateFrom) return `с ${formatRuDateShort(dateFrom)}`;
        if (dateTo) return `по ${formatRuDateShort(dateTo)}`;
        return 'свой период';
    }
  }, [periodPreset, dateFrom, dateTo]);

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);

  // itemsPerPage меняется динамически (см. ResizeObserver выше) — не даём
  // currentPage "вылететь" за пределы диапазона после пересчёта. Вычисляем
  // безопасное значение прямо при рендере (без эффекта), а не мутируем state.
  const safeCurrentPage = Math.min(currentPage, Math.max(1, totalPages));

    // ==================== СОРТИРОВКА: ТЕКУЩИЙ МЕСЯЦ СНАЧАЛА ====================
  const sortedHistory = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');

    return [...filteredHistory].sort((a, b) => {
      const dateA = a.raw_data?.[0]?.date || a.report_date || '';
      const dateB = b.raw_data?.[0]?.date || b.report_date || '';

      // Получаем YYYY-MM для сравнения месяца
      let monthA = '';
      let monthB = '';

      if (dateA.includes('.')) {
        const [_, m, y] = dateA.split('.');
        monthA = `${y}-${m.padStart(2, '0')}`;
      } else {
        monthA = dateA.substring(0, 7);
      }

      if (dateB.includes('.')) {
        const [_, m, y] = dateB.split('.');
        monthB = `${y}-${m.padStart(2, '0')}`;
      } else {
        monthB = dateB.substring(0, 7);
      }

      const currentMonthKey = `${currentYear}-${currentMonth}`;

      // 1. Отчёты текущего месяца — всегда выше
      if (monthA === currentMonthKey && monthB !== currentMonthKey) return -1;
      if (monthB === currentMonthKey && monthA !== currentMonthKey) return 1;

      // 2. Внутри одного месяца — по убыванию даты
      return dateB.localeCompare(dateA);
    });
  }, [filteredHistory]);

  const currentReports = sortedHistory.slice(
    (safeCurrentPage - 1) * itemsPerPage,
    safeCurrentPage * itemsPerPage
  );

  // Фоновый расчёт индикатора на кнопке «Сверка» для видимых строк истории.
  // В checked попадают только успешно посчитанные id — иначе при отмене эффекта
  // из‑за ре-рендера строка навсегда осталась бы без индикатора.
  const visibleReportKey = currentReports.map((r: any) => r.id).join(',');
  useEffect(() => {
    let cancelled = false;

    const checkVisible = async () => {
      for (const report of currentReports) {
        if (cancelled) return;
        const id = String(report.id);
        if (volumeAlertCheckedRef.current.has(id)) continue;

        const dateIso = getReportDateIso(report);
        if (!dateIso) {
          volumeAlertCheckedRef.current.add(id);
          continue;
        }

        try {
          const gradesActual = await fetchGradesActualForDate(dateIso);
          if (cancelled) return;
          const info = computeVolumeAlert(report.raw_data, gradesActual);
          volumeAlertCheckedRef.current.add(id);
          setVolumeAlerts((prev) => ({ ...prev, [id]: info }));
        } catch (err) {
          console.error(`Не удалось проверить расхождение объёма для отчёта #${id}:`, err);
        }
      }
    };

    checkVisible();
    return () => { cancelled = true; };
  // visibleReportKey стабилизирует зависимость: сам currentReports — новый массив каждый рендер
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleReportKey]);

    // ==================== ГРАФИКИ ====================

      // ==================== МЕСЯЧНЫЙ ГРАФИК ====================
      const monthlyVolume = useMemo(() => {
        const groups: any = {};

        filteredHistory.forEach(report => {
          let dateStr = report.raw_data?.[0]?.date || report.report_date || '';
          if (!dateStr) return;

          let monthKey = '';
          if (dateStr.includes('.')) {
            const [_, month, year] = dateStr.split('.');
            monthKey = `${year}-${month.padStart(2, '0')}`;
          } else {
            monthKey = dateStr.substring(0, 7);
          }

          groups[monthKey] = (groups[monthKey] || 0) + (report.total_volume || 0);
        });

        return Object.entries(groups)
          .map(([monthKey, volume]) => ({
            label: monthKey.split('-')[1] + '.' + monthKey.split('-')[0].slice(2),
            value: Math.round(Number(volume) || 0)   // Округление
          }))
          .sort((a, b) => b.label.localeCompare(a.label));
      }, [filteredHistory]);

          // ==================== ДНЕВНОЙ ГРАФИК — С УЛУЧШЕННЫМ TOOLTIP ====================
    const dailyVolume = useMemo(() => {
      const groups: any = {};

      filteredHistory.forEach(report => {
        let dateStr = report.raw_data?.[0]?.date || report.report_date || '';
        if (!dateStr) return;

        let fullDateKey = '';
        if (dateStr.includes('.')) {
          const [day, month, year] = dateStr.split('.');
          fullDateKey = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else {
          fullDateKey = dateStr.substring(0, 10);
        }

        groups[fullDateKey] = (groups[fullDateKey] || 0) + (report.total_volume || 0);
      });

      return Object.entries(groups)
        .map(([fullDate, volume]) => {
          const [year, month, day] = fullDate.split('-');
          const label = `${day}.${month}`;

          return {
            label,
            value: Math.round(Number(volume) || 0),
            fullDate,
            dateObj: new Date(`${fullDate}T12:00:00`)
          };
        })
        // Слева → направо: от старых к новым. Широкий график — больше дней
        // (раньше 31 выглядело «жидко» на широкой колонке).
        .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime())
        .slice(-60);
    }, [filteredHistory]);

      // ==================== КАСТОМНЫЙ TOOLTIP ====================
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: '#1E2937',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '14px'
        }}>
          <div style={{ marginBottom: '6px', color: '#94A3B8' }}>
            {label} • {payload[0].payload.fullDate}
          </div>
          <div style={{ fontWeight: '700', color: '#10B981' }}>
            {payload[0].value} м³
          </div>
        </div>
      );
    }
    return null;
  };

  // ==================== ТОП РЕЦЕПТОВ ====================
  const topRecipes = useMemo(() => {
    const groups: any = {};
    filteredHistory.forEach(report => {
      report.raw_data?.forEach((row: any) => {
        const recipe = row.recipe || 'Неизвестно';
        if (recipe === 'Неизвестно' || recipe.includes('ИТОГО')) return;
        groups[recipe] = (groups[recipe] || 0) + (row.qty || 0);
      });
    });

    return Object.entries(groups)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value], index) => ({
        name,
        value: Number(value) || 0,
        fill: COLORS[index % COLORS.length]
      }));
  }, [filteredHistory]);

    // ==================== КАСТОМНЫЙ TOOLTIP ДЛЯ PIE CHART ====================
  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: '#1E2937',
          padding: '12px 18px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '14px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
        }}>
          <div style={{ 
            fontWeight: '700', 
            color: payload[0].fill,
            marginBottom: '4px'
          }}>
            {data.name}
          </div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#10B981' }}>
            {Math.round(data.value)} м³
          </div>
        </div>
      );
    }
    return null;
  };

    // ==================== РАСХОД МАТЕРИАЛОВ (ПЕРЕСТРОЕННЫЕ ДАННЫЕ) ====================
  const materialConsumption = useMemo(() => {
    let cement = 0, sand = 0, gravel = 0, water = 0, additive = 0;

    filteredHistory.forEach(report => {
      const data = report.raw_data || [];
      cement += data.reduce((sum: number, r: any) => sum + (r.cement || 0), 0);
      sand += data.reduce((sum: number, r: any) => sum + (r.sand || 0), 0);
      gravel += data.reduce((sum: number, r: any) => sum + (r.gravel || 0), 0);
      water += data.reduce((sum: number, r: any) => sum + (r.water || 0), 0);
      additive += data.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
    });

    return [
      { name: 'Цемент', value: Math.round(cement), fill: '#F59E0B' },
      { name: 'Песок', value: Math.round(sand), fill: '#3B82F6' },
      { name: 'Щебень', value: Math.round(gravel), fill: '#10B981' },
      { name: 'Вода', value: Math.round(water), fill: '#8B5CF6' },
      { name: 'Добавка', value: Math.round(additive), fill: '#EF4444' },
    ];
  }, [filteredHistory]);

           // ==================== TOOLTIP ДЛЯ РАСХОДА МАТЕРИАЛОВ ====================
  const MaterialTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length > 0) {
      const entry = payload[0];

      return (
        <div style={{
          backgroundColor: '#1E2937',
          padding: '14px 20px',
          borderRadius: '12px',
          border: '1px solid #475569',
          color: '#fff',
          fontSize: '15px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          minWidth: '220px'
        }}>
          <div style={{ fontWeight: '700', color: '#94A3B8', marginBottom: '8px' }}>
            {label}
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            color: entry.fill || '#10B981'
          }}>
            <span style={{ fontWeight: '600' }}>{entry.name}</span>
            <span style={{ fontWeight: '700', fontSize: '17px' }}>
              {Math.round(entry.value).toLocaleString('ru-RU')} кг
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

    // ==================== СТАТИСТИКА (по выбранному периоду фильтра) ====================
  const stats = useMemo(() => {
    const totalVolume = filteredHistory.reduce((sum, r) => sum + (r.total_volume || 0), 0);
    const totalCement = filteredHistory.reduce((sum, r) => sum + (r.total_cement || 0), 0);
    
    let additive1 = 0;
    let additive2 = 0;

    filteredHistory.forEach(report => {
      const data = report.raw_data || [];
      additive1 += data.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
      additive2 += data.reduce((sum: number, r: any) => sum + (r.additive2 || 0), 0);
    });

    return {
      reports: filteredHistory.length,
      volume: totalVolume.toFixed(1),
      cement: (totalCement / 1000).toFixed(1),
      additive1: Math.round(additive1),
      additive2: Math.round(additive2),
    };
  }, [filteredHistory]);

  // ==================== СПИСОК РЕЦЕПТОВ В ОТКРЫТОМ ОТЧЁТЕ (для фильтра в шапке) ====================
  const availableRecipes = useMemo(() => {
    const counts = new Map<string, number>();
    reportData.forEach(row => {
      counts.set(row.recipe, (counts.get(row.recipe) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [reportData]);

  // Строки текущего отчёта после применения фильтра по рецептам
  const filteredReportData = useMemo(() => {
    if (selectedRecipes === null) return reportData;
    return reportData.filter(row => selectedRecipes.has(row.recipe));
  }, [reportData, selectedRecipes]);





  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      gap: 'clamp(6px, 0.9vh, 14px)'
    }}>
          {/* ==================== СТАТИСТИКА + ФИЛЬТРЫ ====================
              Статистика считается по выбранному периоду (по умолчанию — текущий месяц).
              Пресеты периода влияют и на карточки, и на список/графики. */}
          <div style={volumeCardStyle({
            borderRadius: 16,
            padding: 'clamp(10px, 1.2vh, 14px) clamp(12px, 1.4vw, 18px)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(8px, 1vh, 12px)',
          })}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ color: '#E2E8F0', fontSize: 'clamp(13px, 1vw, 15px)', fontWeight: 600 }}>
                Статистика
                <span style={{ color: '#94A3B8', fontWeight: 500, marginLeft: '8px', fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                  · {periodLabel}
                </span>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 'clamp(6px, 0.8vw, 10px)',
            }}>
              {([
                { label: 'Отчётов', value: String(stats.reports), unit: '', color: '#CBD5E1' },
                { label: 'Объём', value: stats.volume, unit: 'м³', color: '#6EE7B7' },
                { label: 'Цемент', value: stats.cement, unit: 'т', color: '#FBBF24' },
                { label: 'ПФМ-НЛК', value: String(stats.additive1), unit: 'кг', color: '#A78BFA' },
                { label: 'Линомикс', value: String(stats.additive2), unit: 'кг', color: '#F9A8D4' },
              ] as const).map((card) => (
                <div
                  key={card.label}
                  style={volumeCardSoftStyle({
                    borderRadius: 12,
                    padding: 'clamp(6px, 0.9vh, 10px) clamp(8px, 1vw, 12px)',
                    minWidth: 0,
                  })}
                >
                  <div style={{ color: '#94A3B8', fontSize: 'clamp(10px, 0.8vw, 12px)', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {card.label}
                  </div>
                  <div style={{
                    fontSize: 'clamp(16px, 1.6vw, 24px)',
                    fontWeight: 700,
                    color: card.color,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: 1.15,
                  }}>
                    {card.value}
                    {card.unit ? (
                      <span style={{ fontSize: '0.55em', fontWeight: 600, color: '#94A3B8', marginLeft: '4px' }}>
                        {card.unit}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {/* Период — чипы + поиск + свой диапазон */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {PERIOD_PRESETS.map((p) => {
                  const active = periodPreset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPeriodPreset(p.key)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '9999px',
                        border: active ? '1px solid #5B8DEF' : '1px solid #334155',
                        background: active ? 'rgba(74, 106, 138, 0.55)' : '#25334A',
                        color: active ? '#E2E8F0' : '#94A3B8',
                        fontSize: '12px',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                        lineHeight: 1.2,
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Поиск: файл или дата…"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  style={{
                    flex: '1 1 200px',
                    minWidth: '180px',
                    maxWidth: '320px',
                    padding: '7px 14px',
                    backgroundColor: '#25334A',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    color: '#E2E8F0',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />

                {periodPreset === 'custom' && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94A3B8', fontSize: '12px' }}>
                      с
                      <ModalDateInput
                        value={dateFrom}
                        onChange={(v) => {
                          setDateFrom(v);
                          setCurrentPage(1);
                        }}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: '#25334A',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#E2E8F0',
                          fontSize: '13px',
                          colorScheme: 'dark',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94A3B8', fontSize: '12px' }}>
                      по
                      <ModalDateInput
                        value={dateTo}
                        onChange={(v) => {
                          setDateTo(v);
                          setCurrentPage(1);
                        }}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: '#25334A',
                          border: '1px solid #334155',
                          borderRadius: '10px',
                          color: '#E2E8F0',
                          fontSize: '13px',
                          colorScheme: 'dark',
                        }}
                      />
                    </label>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    applyPeriodPreset('month');
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#334155',
                    border: '1px solid #475569',
                    color: '#CBD5E1',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  title="Сбросить поиск и вернуть текущий месяц"
                >
                  Сбросить
                </button>
              </div>
            </div>
          </div>

         {/* Графики + история — общий flex:1 контейнер. Так сумма высот ВСЕГДА
             равна реально доступному месту (какое бы оно ни было на конкретном
             разрешении/с любой шапкой/баннерами над этим блоком) — переполнение
             и обрезка снизу структурно невозможны. Графики предпочитают свою
             высоту (flexBasis), но готовы сжаться (flexShrink:1), если места
             мало; история забирает весь остаток (flex:1) и сама решает, сколько
             строк показать (см. ResizeObserver у historyListRef). */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: 'clamp(6px, 0.9vh, 14px)' }}>
          <div style={{
            display: 'grid',
            // Объём шире (~½ ряда); топ рецептов и материалы — одинаковые узкие колонки
            gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: 'clamp(8px, 1vw, 16px)',
            flex: '0 1 clamp(200px, 27vh, 320px)',
            minHeight: 0
          }}>

                     {/* 1. Объём производства — с переключением */}
            <div style={volumeCardStyle({ padding: 'clamp(10px, 1.4vh, 18px)', borderRadius: 16, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
                <h3 style={{ color: '#E2E8F0', margin: 0, fontSize: 'clamp(13px, 1vw, 16px)' }}>Объём производства</h3>
                
                <div style={{ display: 'flex', backgroundColor: '#25334A', borderRadius: '9999px', padding: '3px', border: '1px solid #334155' }}>
                  <button
                    onClick={() => setViewMode('month')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'month' ? '#3D6B5A' : 'transparent',
                      color: viewMode === 'month' ? '#E2E8F0' : '#94A3B8',
                      border: 'none',
                      fontSize: 'clamp(11px, 0.8vw, 13px)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s ease, color 0.2s ease',
                    }}
                  >
                    По месяцам
                  </button>
                  <button
                    onClick={() => setViewMode('day')}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '9999px',
                      backgroundColor: viewMode === 'day' ? '#3D6B5A' : 'transparent',
                      color: viewMode === 'day' ? '#E2E8F0' : '#94A3B8',
                      border: 'none',
                      fontSize: 'clamp(11px, 0.8vw, 13px)',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s ease, color 0.2s ease',
                    }}
                  >
                    По дням
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart
                  data={viewMode === 'month' ? monthlyVolume : dailyVolume}
                  // Доля зазора от ширины категории — столбцы заполняют слот и при
                  // редких днях месяца (раньше maxBarSize=28 оставлял «иголки»).
                  barCategoryGap={viewMode === 'month' ? '40%' : '18%'}
                  barGap={4}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#94A3B8"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={viewMode === 'day' ? 12 : 8}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
                  <Bar
                    dataKey="value"
                    fill="#10B981"
                    radius={[6, 6, 0, 0]}
                    // Без жёсткого maxBarSize: иначе при 8–12 днях в месяце
                    // слот широкий, а столбец остаётся тонкой линией.
                    isAnimationActive
                    animationDuration={450}
                    animationEasing="ease-out"
                    activeBar={{ fill: '#34D399', stroke: 'none' }}
                  />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>

            {/* ТОП РЕЦЕПТОВ */}
<div style={volumeCardStyle({ borderRadius: 16, padding: 'clamp(10px, 1.4vh, 18px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' })}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexShrink: 0 }}>
    <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>Топ рецептов</h3>
    {isLoading && (
      <span style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          display: 'inline-block',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          border: '2px solid #334155',
          borderTopColor: '#10B981',
          animation: 'spin 0.8s linear infinite',
        }} />
        Загрузка...
      </span>
    )}
  </div>
  
  {/* Квадратная область — пончик не растягивается по ширине колонки */}
  <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон — кольцо-заглушка пока грузятся данные */
      <div style={{
        width: 'clamp(90px, 14vh, 140px)',
        height: 'clamp(90px, 14vh, 140px)',
        borderRadius: '50%',
        border: '20px solid #263040',
        borderTopColor: '#1E3A5F',
        animation: 'spin 1.4s linear infinite',
        opacity: 0.6,
      }} />
    ) : (
      <div style={{
        width: '100%',
        height: '100%',
        maxWidth: 'min(100%, 220px)',
        maxHeight: 'min(100%, 220px)',
        aspectRatio: '1',
        animation: topRecipes.length > 0
          ? 'chartReveal 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards'
          : 'none',
        transformOrigin: 'center',
      }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
          <PieChart>
            <Pie
              data={topRecipes}
              cx="50%"
              cy="50%"
              innerRadius="52%"
              outerRadius="80%"
              paddingAngle={topRecipes.length > 1 ? 2 : 0}
              dataKey="value"
              nameKey="name"
              isAnimationActive
              animationDuration={500}
              animationEasing="ease-out"
              stroke="none"
            >
              {topRecipes.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<CustomPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>

  {/* Легенда в одну строку с переносом */}
  <div style={{ 
    display: 'flex', 
    flexWrap: 'wrap', 
    gap: '6px 16px', 
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 'clamp(11px, 0.8vw, 13px)',
    minHeight: isLoading && topRecipes.length === 0 ? '30px' : 'auto',
  }}>
    {isLoading && topRecipes.length === 0 ? (
      /* Скелетон легенды */
      [0,1,2,3,4,5].map(i => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: '#263040' }} />
          <div style={{ width: `${60 + (i % 3) * 20}px`, height: '12px', borderRadius: '4px', background: '#263040' }} />
        </div>
      ))
    ) : (
      topRecipes.map((recipe, index) => (
        <div key={index} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ 
            width: '12px', 
            height: '12px', 
            backgroundColor: recipe.fill, 
            borderRadius: '3px',
            flexShrink: 0
          }} />
          <div>
            <span style={{ fontWeight: '600' }}>{recipe.name}</span>
            <span style={{ color: '#10B981', marginLeft: '6px', fontWeight: '700' }}>
              {Math.round(recipe.value)} м³
            </span>
          </div>
        </div>
      ))
    )}
  </div>
</div>

         {/* ==================== РАСХОД МАТЕРИАЛОВ С ПЕРЕКЛЮЧАТЕЛЕМ ==================== */}
<div style={volumeCardStyle({ borderRadius: 16, padding: 'clamp(10px, 1.4vh, 18px)', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' })}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexShrink: 0 }}>
    <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>Расход материалов</h3>
    
    <div style={{
      background: '#25334A',
      borderRadius: '9999px',
      padding: '3px',
      display: 'flex',
      border: '1px solid #334155',
    }}>
      <button
        onClick={() => setScaleMode('linear')}
        style={{
          padding: '5px 14px',
          borderRadius: '9999px',
          background: scaleMode === 'linear' ? '#3D6B5A' : 'transparent',
          color: scaleMode === 'linear' ? '#E2E8F0' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: 'clamp(11px, 0.8vw, 13px)',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease, color 0.2s ease',
        }}
      >
        Линейный
      </button>
      <button
        onClick={() => setScaleMode('log')}
        style={{
          padding: '5px 14px',
          borderRadius: '9999px',
          background: scaleMode === 'log' ? '#3D6B5A' : 'transparent',
          color: scaleMode === 'log' ? '#E2E8F0' : '#94A3B8',
          border: 'none',
          fontWeight: '600',
          fontSize: 'clamp(11px, 0.8vw, 13px)',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease, color 0.2s ease',
        }}
      >
        Логарифмический
      </button>
    </div>
  </div>
  
  <div style={{ flex: 1, minHeight: 0, maxWidth: '100%' }}>
  <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_DIMENSION}>
    <BarChart
      data={materialConsumption}
      barCategoryGap="22%"
      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
      <XAxis dataKey="name" stroke="#94A3B8" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
      <YAxis
        stroke="#94A3B8"
        tickLine={false}
        axisLine={false}
        width={36}
        scale={scaleMode === 'log' ? 'log' : 'linear'}
        domain={scaleMode === 'log' ? [1, 'dataMax'] : [0, 'dataMax']}
        tickFormatter={(value) => (value / 1000).toFixed(0) + 'k'}
        tick={{ fontSize: 11 }}
      />
      <Tooltip content={<MaterialTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
      <Bar
        dataKey="value"
        radius={[6, 6, 0, 0]}
        isAnimationActive
        animationDuration={450}
        animationEasing="ease-out"
      >
        {materialConsumption.map((entry, index) => (
          <Cell key={`mat-${index}`} fill={entry.fill} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
  </div>

  {/* Легенда — цвета как у столбцов */}
  <div style={{
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 16px',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 'clamp(11px, 0.8vw, 13px)',
  }}>
    {materialConsumption.map((item) => (
      <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '12px', height: '12px', backgroundColor: item.fill, borderRadius: '3px' }} />
        <span style={{ fontWeight: 500 }}>{item.name}</span>
      </div>
    ))}
  </div>
</div>
            </div>

                              {/* ====================== ИСТОРИЯ ====================== */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px', flexShrink: 0 }}>
            <h3 style={{ margin: 0, color: '#94A3B8', fontSize: 'clamp(13px, 1vw, 16px)' }}>
              История загруженных отчётов ({filteredHistory.length})
            </h3>

            {/* ====================== КНОПКА ЗАГРУЗКИ НОВОГО ОТЧЕТА ====================== */}
            <label style={{
              color: '#10B981',
              padding: '6px 16px',
              fontWeight: '600',
              fontSize: 'clamp(12px, 0.9vw, 14px)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'transparent',
              border: '1px solid #10B981',
              borderRadius: '9999px',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
             }}>
              Загрузить новый отчёт MEKA (.xls / .xlsx)

              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  try {
                    const XLSX = await import('xlsx');
                    const data = await file.arrayBuffer();
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];

                    const jsonData = XLSX.utils.sheet_to_json(sheet, {
                      range: 5,
                      defval: '',
                      blankrows: false
                    });

                    const processed = jsonData.map((row: any) => ({
                      no: row['__EMPTY_3'] || row['NO'] || '-',
                      date: row['__EMPTY_1'] || row['DATE'] || '',
                      time: row['__EMPTY_2'] || '',
                      recipe: row['__EMPTY_4'] || row['RECIPE CODE'] || 'Неизвестно',

                      qty: Number(row['__EMPTY_5'] || 0),
                      sand:    Number(row['__EMPTY_6'] || 0),
                      gravel:  Number(row['__EMPTY_7'] || 0),
                      cement:  Number(row['__EMPTY_12'] || 0),
                      water:   Number(row['__EMPTY_18'] || 0),
                      additive: Number(row['__EMPTY_20'] || 0),     // ПФМ-НЛК
                      additive2: Number(row['__EMPTY_21'] || row['__EMPTY_22'] || 0), // Линомикс
                    })).filter(r => r.qty > 0 && r.qty < 1000 && r.recipe !== 'Неизвестно' && !r.recipe.includes('ИТОГО') && r.no !== '-');

                    const totalVolume = processed.reduce((sum: number, r: any) => sum + r.qty, 0);
                    const totalCement = processed.reduce((sum: number, r: any) => sum + r.cement, 0);

                    // === РАСЧЁТ РАСХОДА ДОБАВОК ===
                    const totalAdditive1 = processed.reduce((sum: number, r: any) => sum + (r.additive || 0), 0);
                    const totalAdditive2 = processed.reduce((sum: number, r: any) => sum + (r.additive2 || 0), 0);

                    // === ИСПРАВЛЕНИЕ ДАТЫ ===
                    let reportDate = processed[0]?.date || '';
                    if (reportDate.includes('.')) {
                      const [day, month, year] = reportDate.split('.');
                      reportDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    }

                    const res = await fetch('/api/adminCifra/meka-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        file_name: file.name,
                        report_date: reportDate,
                        total_volume: totalVolume,
                        total_cement: totalCement,
                        raw_data: processed
                      })
                    });

                    if (res.ok) {
                      let successMessage = `✅ Отчёт "${file.name}" успешно загружен!\nПартий: ${processed.length} • Объём: ${formatVolumeM3(totalVolume)} м³`;

                      // Сверка добавок: колонки MEKA vs отгрузки × рецепт (без склада).
                      if ((totalAdditive1 > 0 || totalAdditive2 > 0) && reportDate) {
                        try {
                          const [recipes, gradesActual] = await Promise.all([
                            loadRecipesForReconcile(),
                            fetchGradesActualForDate(reportDate),
                          ]);
                          const normative = getNormativeAdditivesFromShipments(gradesActual, recipes);
                          successMessage +=
                            `\n\nСверка добавок:\n` +
                            `ПФМ-НЛК — отгрузки×рецепт: ${normative.pfmKg.toFixed(1)} кг, MEKA: ${totalAdditive1.toFixed(1)} кг\n` +
                            `Линомикс ТипР — отгрузки×рецепт: ${normative.linomixKg.toFixed(1)} кг, MEKA: ${totalAdditive2.toFixed(1)} кг`;
                        } catch (err) {
                          console.error('Не удалось получить сверку добавок:', err);
                        }
                      }

                      alert(successMessage);

                      loadHistory();
                      setReportData(processed);
                    } else {
                      const errorText = await res.text();
                      console.error('Ошибка сервера:', errorText);
                      alert(`Ошибка сохранения:\n${errorText}`);
                    }
                  } catch (err: any) {
                    console.error(err);
                    alert('Ошибка обработки файла');
                  }
                }}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexShrink: 0 }}>
              <div style={{ color: '#94A3B8' }}>
                Страница {safeCurrentPage} из {totalPages}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                  disabled={safeCurrentPage === 1}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: safeCurrentPage === 1 ? 'not-allowed' : 'pointer',
                    opacity: safeCurrentPage === 1 ? 0.5 : 1 
                  }}
                >
                  ← Назад
                </button>
                <button 
                  onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                  disabled={safeCurrentPage === totalPages}
                  style={{ 
                    padding: '8px 16px', 
                    borderRadius: '9999px', 
                    backgroundColor: '#334155', 
                    border: 'none', 
                    color: 'white', 
                    cursor: safeCurrentPage === totalPages ? 'not-allowed' : 'pointer',
                    opacity: safeCurrentPage === totalPages ? 0.5 : 1 
                  }}
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}

          {/* Список не скроллится — количество строк (itemsPerPage) подстраивается
              под реально доступную высоту через ResizeObserver на этом контейнере. */}
          <div ref={historyListRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {currentReports.length > 0 ? currentReports.map((report: any) => {
              // Компактные кнопки одной ширины — колонки ровные по всему списку,
              // текст «Сверка !» не раздвигает ряд (алерт только цветом).
              const historyBtnBase: CSSProperties = {
                width: '72px',
                height: '24px',
                padding: 0,
                border: 'none',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
                color: '#E2E8F0',
                lineHeight: '24px',
                textAlign: 'center',
                flexShrink: 0,
                boxSizing: 'border-box',
              };
              const volumeAlert = volumeAlerts[String(report.id)];
              const isVolumeAlert = Boolean(volumeAlert?.over);
              const percentLabel = volumeAlert && Number.isFinite(volumeAlert.percent)
                ? `${volumeAlert.percent.toFixed(2)}%`
                : volumeAlert?.over
                  ? '>0.5%'
                  : null;

              return (
              <div 
                key={report.id} 
                style={{
                  backgroundColor: '#25334A',
                  padding: '5px 14px',
                  borderRadius: '10px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: 'clamp(11px, 0.85vw, 13.5px)',
                  flexShrink: 0,
                  minHeight: 0,
                }}
              >
                <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  <strong>
                    {(() => {
                      const excelDate = report.raw_data?.[0]?.date || report.report_date || '';
                      if (excelDate && excelDate.includes('.')) return excelDate;
                      const dateStr = excelDate || report.report_date || '';
                      if (!dateStr) return '-';
                      const parts = dateStr.split('-');
                      if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0].slice(2)}`;
                      return dateStr;
                    })()}
                  </strong>
                  <span style={{ color: '#94A3B8', marginLeft: '10px' }}>
                    {report.raw_data?.length || 0} партий • {formatVolumeM3(report.total_volume || 0)} м³ • {report.file_name}
                  </span>
                </div>

                {/* Сетка с фиксированными колонками — кнопки не смещаются между строками */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: userRole === 'admin' ? 'repeat(4, 72px)' : 'repeat(3, 72px)',
                  gap: '5px',
                  flexShrink: 0,
                  alignItems: 'center',
                }}>
                  <button 
                    style={{ ...historyBtnBase, backgroundColor: '#3D6B5A' }}
                    onClick={() => {
                      const excelDate = report.raw_data?.[0]?.date || report.report_date || '';
                      setReportData(report.raw_data || []);
                      setOpenReportMeta({ fileName: report.file_name, dateLabel: excelDate });
                      setSelectedRecipes(null);
                      setRecipeFilterOpen(false);
                    }}
                  >
                    Открыть
                  </button>
                  <button
                    style={{
                      ...historyBtnBase,
                      backgroundColor: isVolumeAlert ? '#9A7B3C' : '#4A6A8A',
                      cursor: reconcileLoadingId === report.id ? 'wait' : 'pointer',
                      opacity: reconcileLoadingId === report.id ? 0.7 : 1,
                    }}
                    disabled={reconcileLoadingId === report.id}
                    onClick={() => openReconcileForReport(report)}
                    title={isVolumeAlert && volumeAlert
                      ? `Расхождение объёма ${percentLabel} (> ${RECONCILE_VOLUME_ALERT_PERCENT}%): план ${volumeAlert.planM3} м³, факт ${volumeAlert.actualM3} м³`
                      : 'Сверка: добавки (норма/завод MEKA) и марки (MEKA vs отгрузка). Склад не учитывается.'}
                  >
                    {reconcileLoadingId === report.id ? '…' : 'Сверка'}
                  </button>
                  <button 
                    style={{ ...historyBtnBase, backgroundColor: '#4A5568' }}
                    onClick={closeReportModal}
                  >
                    Скрыть
                  </button>
                  {userRole === 'admin' && (
                    <button 
                      style={{ ...historyBtnBase, backgroundColor: '#8B4A4A' }}
                      onClick={async () => {
                        if (!(await appConfirm('Удалить этот отчёт?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;

                        try {
                          console.log(`🗑 Удаляем отчёт #${report.id}`);

                          const deleteRes = await fetch(`/api/adminCifra/meka-report?id=${report.id}`, { 
                            method: 'DELETE' 
                          });

                          if (deleteRes.ok) {
                            console.log('✅ Отчёт успешно удалён');
                            loadHistory();
                            alert('✅ Отчёт успешно удалён');
                          } else {
                            alert('❌ Ошибка при удалении отчёта');
                          }
                        } catch (err) {
                          console.error('❌ Ошибка при удалении:', err);
                          alert('Произошла ошибка при удалении');
                        }
                      }}
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
              );
            }) : (
              <div data-report-placeholder="true" style={{ padding: '60px', textAlign: 'center', color: '#64748B', backgroundColor: '#25334A', borderRadius: '16px' }}>
                Отчёты по выбранным фильтрам не найдены
              </div>
            )}
          </div>
          </div>
          </div>

          {/* Текущий отчёт — модальное окно, а не блок в потоке страницы.
              Так исключён сам класс багов с "провалом" колеса мыши во вложенном
              скролл-контейнере: у модалки ровно одна зона вертикального скролла
              (тело модалки), она не зависит от скролла страницы под ней. */}
          {reportData.length > 0 && (
            <>
              <div
                onClick={closeReportModal}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200 }}
              />
              <div
                ref={modalPanelRef}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 201,
                  width: 'min(1240px, 94vw)',
                  // Фиксированная height (а не maxHeight!) обязательна: иначе при пустой
                  // выборке (например, "Снять все" в фильтре рецептов) высота модалки
                  // "сжималась" по контенту почти до нуля и вырезала (overflow: hidden)
                  // абсолютно спозиционированный выпадающий список фильтра — визуально это
                  // выглядело так, будто "марки из фильтра пропадают". Фиксированная высота
                  // также гарантирует, что body модалки всегда получает строго заданную
                  // высоту и скролл внутри неё работает предсказуемо при любом числе строк.
                  height: '86vh',
                  ...volumeModalStyle({
                    borderRadius: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }),
                }}
              >
                {/* Заголовок модалки */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '20px 24px',
                  borderBottom: CARD_BORDER,
                  flexShrink: 0
                }}>
                  <h3 style={{ margin: 0, color: '#10B981', fontSize: '17px' }}>
                    ✅ Отчёт{openReportMeta?.dateLabel ? ` от ${openReportMeta.dateLabel}` : ''} • {filteredReportData.length}
                    {selectedRecipes !== null ? ` из ${reportData.length}` : ''} партий
                    {openReportMeta?.fileName && (
                      <span style={{ color: '#64748B', fontWeight: 400, fontSize: '13px', marginLeft: '10px' }}>
                        {openReportMeta.fileName}
                      </span>
                    )}
                  </h3>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {selectedRecipes !== null && (
                      <button
                        onClick={() => setSelectedRecipes(null)}
                        style={volumeCardSoftStyle({
                          fontSize: '12px',
                          fontWeight: '600',
                          color: '#94A3B8',
                          borderRadius: 9999,
                          padding: '6px 14px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        })}
                      >
                        ✕ Сбросить фильтр рецептов
                      </button>
                    )}
                    <button
                      onClick={closeReportModal}
                      title="Закрыть (Esc)"
                      style={modalCloseButtonStyle({
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        fontSize: '16px',
                        color: '#E2E8F0',
                      })}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Тело модалки: одна зона скролла (x+y) — иначе overflow-x
                    на вложенном div ломает position:sticky у шапки таблицы. */}
                <div
                  ref={modalBodyRef}
                  className="scroll-subtle"
                  onScroll={() => setRecipeFilterOpen(false)}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    padding: '20px 24px',
                    borderRadius: '0 0 20px 20px',
                  }}
                >
              <table style={volumeCardSoftStyle({
                width: '100%',
                minWidth: '980px',
                borderCollapse: 'separate',
                borderSpacing: 0,
                borderRadius: 16,
              })}>
                <thead>
                  <tr>
                    {([
                      { label: 'NO', align: 'left' as const },
                      { label: 'Дата', align: 'left' as const },
                      { label: 'Время', align: 'left' as const },
                      { label: 'Рецепт', align: 'left' as const, recipe: true },
                      { label: 'Объём (м³)', align: 'right' as const },
                      { label: 'Цемент (кг)', align: 'right' as const },
                      { label: 'Песок (кг)', align: 'right' as const },
                      { label: 'Щебень (кг)', align: 'right' as const },
                      { label: 'Вода (кг)', align: 'right' as const },
                      { label: 'Добавка', align: 'right' as const },
                      { label: 'Добавка2', align: 'right' as const },
                    ]).map((col) => (
                      <th
                        key={col.label}
                        style={{
                          padding: '14px',
                          textAlign: col.align,
                          whiteSpace: 'nowrap',
                          position: 'sticky',
                          top: 0,
                          zIndex: col.recipe ? 3 : 2,
                          backgroundColor: '#334155',
                          boxShadow: 'inset 0 -1px 0 #475569',
                        }}
                      >
                        {col.recipe ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            <span>Рецепт</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                const panelRect = modalPanelRef.current?.getBoundingClientRect();
                                setRecipeFilterPos({
                                  top: rect.bottom - (panelRect?.top ?? 0) + 6,
                                  left: rect.left - (panelRect?.left ?? 0)
                                });
                                setRecipeFilterSearch('');
                                setRecipeFilterOpen(o => !o);
                              }}
                              title="Фильтр по рецепту"
                              style={{
                                background: selectedRecipes !== null ? '#10B981' : 'transparent',
                                border: 'none',
                                borderRadius: '4px',
                                color: selectedRecipes !== null ? '#fff' : '#94A3B8',
                                cursor: 'pointer',
                                padding: '2px 5px',
                                fontSize: '11px',
                                lineHeight: 1
                              }}
                            >
                              ▼
                            </button>
                          </div>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredReportData.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #334155' }}>
                      <td style={{ padding: '14px' }}>{row.no}</td>
                      <td style={{ padding: '14px' }}>{row.date}</td>
                      <td style={{ padding: '14px' }}>{row.time}</td>
                      <td style={{ padding: '14px', fontWeight: '600' }}>{row.recipe}</td>
                      <td style={{ padding: '14px', textAlign: 'right', color: '#10B981', fontWeight: '600' }}>{formatVolumeM3(row.qty)}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.cement).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.sand).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.gravel).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{Math.round(row.water).toLocaleString('ru-RU')}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>{row.additive.toFixed(3)}</td>
                      <td style={{ padding: '14px', textAlign: 'right' }}>
                        {row.additive2 > 0 ? row.additive2.toFixed(3) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>

      {/* ИТОГОВАЯ СТРОКА (только одна, считается по отфильтрованным строкам) */}
                <tfoot>
                  <tr style={{ 
                    backgroundColor: '#334155', 
                    fontWeight: '700', 
                    fontSize: '16px',
                    borderTop: '3px solid #10B981'
                  }}>
                    <td style={{ padding: '16px 14px' }} colSpan={4}>
                      <strong>ИТОГО{selectedRecipes !== null ? ' ПО ФИЛЬТРУ' : ' ЗА ДЕНЬ'}</strong>
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right', color: '#10B981' }}>
                      {formatVolumeM3(filteredReportData.reduce((sum, r) => sum + (r.qty || 0), 0))} м³
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.cement || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.sand || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.gravel || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {Math.round(filteredReportData.reduce((sum, r) => sum + (r.water || 0), 0)).toLocaleString('ru-RU')} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {filteredReportData.reduce((sum, r) => sum + (r.additive || 0), 0).toFixed(3)} кг
                    </td>
                    <td style={{ padding: '16px 14px', textAlign: 'right' }}>
                      {filteredReportData.reduce((sum, r) => sum + (r.additive2 || 0), 0).toFixed(3)} кг
                    </td>
                  </tr>
                </tfoot>
              </table>
                </div>

                {/* Выпадающий список фильтра рецептов — вне скролла таблицы
                    (position: fixed от кнопки), чтобы autoFocus поиска не
                    сдвигал горизонтальный скролл. */}
                {recipeFilterOpen && (
                  <>
                    <div
                      onClick={() => setRecipeFilterOpen(false)}
                      style={{ position: 'fixed', inset: 0, zIndex: 210 }}
                    />
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={volumeCardSoftStyle({
                        position: 'fixed',
                        top: recipeFilterPos.top,
                        left: recipeFilterPos.left,
                        zIndex: 211,
                        borderRadius: 12,
                        padding: '10px',
                        minWidth: '220px',
                        maxHeight: '320px',
                        overflowY: 'auto',
                        fontWeight: '400',
                        fontSize: '14px',
                        textTransform: 'none',
                      })}
                    >
                      <input
                        type="text"
                        placeholder="Поиск рецепта..."
                        value={recipeFilterSearch}
                        onChange={(e) => setRecipeFilterSearch(e.target.value)}
                        autoFocus
                        style={modalFieldStyle({
                          padding: '8px 10px',
                          marginBottom: '8px',
                          borderRadius: 8,
                          fontSize: '13px',
                        })}
                      />

                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <button
                          onClick={() => setSelectedRecipes(null)}
                          style={volumeCardSoftStyle({ flex: 1, padding: '6px', borderRadius: 6, color: '#E2E8F0', fontSize: '12px', cursor: 'pointer' })}
                        >
                          Выбрать все
                        </button>
                        <button
                          onClick={() => setSelectedRecipes(new Set())}
                          style={volumeCardSoftStyle({ flex: 1, padding: '6px', borderRadius: 6, color: '#E2E8F0', fontSize: '12px', cursor: 'pointer' })}
                        >
                          Снять все
                        </button>
                      </div>

                      {availableRecipes
                        .filter(r => r.name.toLowerCase().includes(recipeFilterSearch.toLowerCase()))
                        .map(r => {
                          const isChecked = selectedRecipes === null || selectedRecipes.has(r.name);
                          return (
                            <label
                              key={r.name}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer', borderRadius: '6px' }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedRecipes(prev => {
                                    // null значит "все выбраны" — материализуем полный
                                    // список, чтобы можно было снять галку с одного.
                                    const base = prev === null
                                      ? new Set(availableRecipes.map(r2 => r2.name))
                                      : new Set(prev);
                                    if (base.has(r.name)) base.delete(r.name);
                                    else base.add(r.name);
                                    // Если в итоге выбраны все — возвращаемся к "фильтр не применён"
                                    return base.size === availableRecipes.length ? null : base;
                                  });
                                }}
                              />
                              <span style={{ flex: 1 }}>{r.name}</span>
                              <span style={{ color: '#64748B', fontSize: '12px' }}>{r.count}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Сверка: добавки + марки (план MEKA vs факт приложения) */}
          {reconcileModal && (
            <>
              <div
                onClick={() => setReconcileModal(null)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 220 }}
              />
              <div
                onClick={(e) => e.stopPropagation()}
                className="scroll-hidden"
                style={volumeModalStyle({
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 221,
                  borderRadius: 20,
                  padding: '28px 32px',
                  width: '100%',
                  maxWidth: '560px',
                  maxHeight: '85vh',
                  overflowY: 'auto',
                  color: '#fff',
                })}
              >
                <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>
                  Сверка план / факт
                </div>
                <div style={{ color: '#94A3B8', fontSize: '13.5px', marginBottom: '22px' }}>
                  {reconcileModal.dateLabel}
                  {reconcileModal.fileName ? ` · ${reconcileModal.fileName}` : ''}
                </div>

                {reconcileModal.loading ? (
                  <div style={{ color: '#94A3B8', textAlign: 'center', padding: '24px 0' }}>
                    Считаем норму по рецептам и отгрузку…
                  </div>
                ) : reconcileModal.error ? (
                  <div style={{ color: '#F87171', textAlign: 'center', padding: '24px 0' }}>
                    {reconcileModal.error}
                  </div>
                ) : (
                  <>
                    <div style={{ color: '#94A3B8', fontSize: '12.5px', fontWeight: 600, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Добавки
                    </div>
                    {(
                      [
                        { key: 'pfm', label: 'ПФМ-НЛК', plan: reconcileModal.plan.pfmKg, actual: reconcileModal.actual?.pfmKg ?? 0 },
                        { key: 'linomix', label: 'Линомикс ТипР', plan: reconcileModal.plan.linomixKg, actual: reconcileModal.actual?.linomixKg ?? 0 },
                      ] as const
                    ).map((row) => {
                      const delta = Math.round((row.actual - row.plan) * 10) / 10;
                      const deltaColor = Math.abs(delta) < 0.05 ? '#10B981' : delta > 0 ? '#F59E0B' : '#F87171';
                      return (
                        <div
                          key={row.key}
                          style={volumeCardSoftStyle({
                            borderRadius: 14,
                            padding: '14px 18px',
                            marginBottom: '10px',
                          })}
                        >
                          <div style={{ fontWeight: 600, marginBottom: '10px' }}>{row.label}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '13.5px' }}>
                            <div>
                              <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '2px' }}>Отгрузки×рецепт</div>
                              <div style={{ fontWeight: 600 }}>{row.plan.toFixed(1)} кг</div>
                            </div>
                            <div>
                              <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '2px' }}>MEKA</div>
                              <div style={{ fontWeight: 600 }}>{row.actual.toFixed(1)} кг</div>
                            </div>
                            <div>
                              <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '2px' }}>Дельта</div>
                              <div style={{ fontWeight: 700, color: deltaColor }}>
                                {delta > 0 ? '+' : ''}{delta.toFixed(1)} кг
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ color: '#64748B', fontSize: '12.5px', marginTop: '2px', marginBottom: '22px' }}>
                      Партий MEKA: {reconcileModal.trips ?? 0}
                      {' · '}отгрузки×рецепт = м³ отгрузки × кг/м³ из рецепта
                      {' · '}MEKA = колонки «Добавка 1/2» отчёта
                      {' · '}склад не учитывается
                    </div>

                    <div style={{ color: '#94A3B8', fontSize: '12.5px', fontWeight: 600, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Марки бетона
                    </div>
                    <div style={volumeCardSoftStyle({
                      borderRadius: 14,
                      overflow: 'hidden',
                      marginBottom: '8px',
                      padding: 0,
                    })}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.9fr',
                        gap: '8px',
                        padding: '10px 16px',
                        color: '#94A3B8',
                        fontSize: '12px',
                        borderBottom: CARD_BORDER,
                      }}>
                        <div>Марка</div>
                        <div style={{ textAlign: 'right' }}>MEKA, м³</div>
                        <div style={{ textAlign: 'right' }}>Отгрузка, м³</div>
                        <div style={{ textAlign: 'right' }}>Дельта</div>
                      </div>
                      {reconcileModal.grades.length > 0 ? reconcileModal.grades.map((row) => {
                        const delta = Math.round((row.actualM3 - row.planM3) * 10) / 10;
                        const deltaColor = Math.abs(delta) < 0.05 ? '#10B981' : delta > 0 ? '#F59E0B' : '#F87171';
                        return (
                          <div
                            key={row.grade}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.9fr',
                              gap: '8px',
                              padding: '11px 16px',
                              fontSize: '13.5px',
                              borderBottom: CARD_BORDER,
                              alignItems: 'center',
                            }}
                          >
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.grade}>
                              {row.grade}
                            </div>
                            <div style={{ textAlign: 'right' }}>{row.planM3.toFixed(1)}</div>
                            <div style={{ textAlign: 'right' }}>{row.actualM3.toFixed(1)}</div>
                            <div style={{ textAlign: 'right', fontWeight: 700, color: deltaColor }}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </div>
                          </div>
                        );
                      }) : (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#64748B', fontSize: '13.5px' }}>
                          Нет данных по маркам за этот день
                        </div>
                      )}
                      {reconcileModal.grades.length > 0 && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.9fr',
                          gap: '8px',
                          padding: '12px 16px',
                          fontSize: '13.5px',
                          fontWeight: 700,
                          borderTop: CARD_BORDER,
                          color: '#E2E8F0',
                        }}>
                          <div>Итого</div>
                          <div style={{ textAlign: 'right' }}>
                            {reconcileModal.grades.reduce((s, r) => s + r.planM3, 0).toFixed(1)}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            {reconcileModal.grades.reduce((s, r) => s + r.actualM3, 0).toFixed(1)}
                          </div>
                          <div style={{ textAlign: 'right', color: (() => {
                            const d = Math.round((
                              reconcileModal.grades.reduce((s, r) => s + r.actualM3, 0) -
                              reconcileModal.grades.reduce((s, r) => s + r.planM3, 0)
                            ) * 10) / 10;
                            return Math.abs(d) < 0.05 ? '#10B981' : d > 0 ? '#F59E0B' : '#F87171';
                          })() }}>
                            {(() => {
                              const d = Math.round((
                                reconcileModal.grades.reduce((s, r) => s + r.actualM3, 0) -
                                reconcileModal.grades.reduce((s, r) => s + r.planM3, 0)
                              ) * 10) / 10;
                              return `${d > 0 ? '+' : ''}${d.toFixed(1)}`;
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ color: '#64748B', fontSize: '12.5px', marginBottom: '18px' }}>
                      Марки: MEKA — объём партий в отчёте · отгрузка — рейсы в приложении (дата доставки)
                      {' · '}дельта = отгрузка − MEKA
                    </div>
                  </>
                )}

                <button
                  onClick={() => setReconcileModal(null)}
                  style={volumeCardSoftStyle({
                    width: '100%',
                    padding: '14px',
                    color: '#fff',
                    borderRadius: 9999,
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  })}
                >
                  Закрыть
                </button>
              </div>
            </>
          )}
    </div>
  );
}