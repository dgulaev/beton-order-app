/**
 * Текст «Планирование отгрузки» для дашборда (колонка «Миксеры в работе»).
 * Диспетчер правит план и копирует в Макс для водителей.
 * Черновики — в localStorage, ключи dailyReport_* / dailyReport_auto_*.
 */

import { sortMixersByLogisticsTime } from '@/lib/mixerTimeSort';
import { resolveOrderReceivingContact } from '@/lib/orderContact';
import { formatRuDateWithWeekday, formatTimeHHMM } from '@/lib/ruLocale';

/** Совпадает с PICKUP_MIXER_NUMBER в logisticsPlanner (без циклического импорта). */
const PICKUP_LABEL = 'самовывоз';

export type DailyReportMixerLine = {
  number: string;
  time: string;
  volume: number;
  status: string;
};

export type DailyReportOrderGroup = {
  orderId: number | string;
  client: string;
  deliveryTime: string;
  grade: string;
  /** План по заявке, м³ */
  orderVolume: number;
  orderStatus: string;
  address: string;
  /** Имя на приёмке из комментария (если удалось вытащить) */
  contactName: string;
  /** Телефон: из комментария, иначе из заявки */
  contactPhone: string;
  mixers: DailyReportMixerLine[];
};

const DRAFT_PREFIX = 'dailyReport_';
const AUTO_PREFIX = 'dailyReport_auto_';
/** Хранить черновики не дольше N дней. */
const DRAFT_KEEP_DAYS = 14;

export function dailyReportEditedKey(dateKey: string): string {
  return `${DRAFT_PREFIX}${dateKey}`;
}

export function dailyReportAutoKey(dateKey: string): string {
  return `${AUTO_PREFIX}${dateKey}`;
}

/** Удалить черновики старше DRAFT_KEEP_DAYS (и битые ключи без даты). */
export function pruneDailyReportDrafts(now = new Date()): number {
  if (typeof localStorage === 'undefined') return 0;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - DRAFT_KEEP_DAYS);
  const cutoffKey = [
    cutoff.getFullYear(),
    String(cutoff.getMonth() + 1).padStart(2, '0'),
    String(cutoff.getDate()).padStart(2, '0'),
  ].join('-');

  let removed = 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }
  for (const key of keys) {
    if (!key.startsWith(DRAFT_PREFIX) && !key.startsWith(AUTO_PREFIX)) continue;
    const datePart = key.startsWith(AUTO_PREFIX)
      ? key.slice(AUTO_PREFIX.length)
      : key.slice(DRAFT_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || datePart < cutoffKey) {
      localStorage.removeItem(key);
      removed += 1;
    }
  }
  return removed;
}

export function buildDailyMixerReportGroups(opts: {
  orders: Array<{
    id: number | string;
    organization_name?: string | null;
    full_name?: string | null;
    delivery_time?: string | null;
    grade?: string | null;
    volume?: number | string | null;
    status?: string | null;
    address?: string | null;
    phone?: string | null;
    comment?: string | null;
  }>;
  mixers: Array<{
    orderId?: number | string | null;
    order_id?: number | string | null;
    number?: string | null;
    mixer_name?: string | null;
    time?: string | null;
    volume?: number | string | null;
    status?: string | null;
    sortOrder?: number | null;
  }>;
}): DailyReportOrderGroup[] {
  const sortedOrders = [...opts.orders]
    .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
    .sort((a, b) =>
      String(a.delivery_time || '00:00').localeCompare(String(b.delivery_time || '00:00')),
    );

  return sortedOrders.map((order) => {
    const mixersForOrder = opts.mixers.filter(
      (m) => String(m.orderId ?? m.order_id) === String(order.id)
    );
    const sorted = sortMixersByLogisticsTime(mixersForOrder);
    const contact = resolveOrderReceivingContact(order);
    return {
      orderId: order.id,
      client: String(order.organization_name || order.full_name || '—').trim() || '—',
      deliveryTime: formatTimeHHMM(order.delivery_time) || '—',
      grade: String(order.grade || '').trim() || '—',
      orderVolume: Number(order.volume || 0),
      orderStatus: String(order.status || ''),
      address: String(order.address || '').trim(),
      contactName: contact.name || '',
      contactPhone: contact.phoneDisplay || '',
      mixers: sorted.map((m) => ({
        number: String(m.number || m.mixer_name || '—'),
        time: m.time && m.time !== '—' ? formatTimeHHMM(String(m.time)) || '—' : '—',
        volume: Number(m.volume || 0),
        status: String(m.status || '—'),
      })),
    };
  });
}

const ORDER_STATUS_RU: Record<string, string> = {
  new: 'новая',
  processing: 'в работе',
  completed: 'выполнена',
  cancelled: 'отменена',
};

/** «1 заявка / 2 заявки / 5 заявок» */
export function formatRuZayavkiCount(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n100 >= 11 && n100 <= 14) return `${abs} заявок`;
  if (n10 === 1) return `${abs} заявка`;
  if (n10 >= 2 && n10 <= 4) return `${abs} заявки`;
  return `${abs} заявок`;
}

function isCompletedReportGroup(
  group: DailyReportOrderGroup,
  completedOrderIds?: Set<string>,
): boolean {
  if (completedOrderIds?.has(String(group.orderId))) return true;
  return String(group.orderStatus || '').toLowerCase() === 'completed';
}

/** «субботу, 25 июля» — для шапки «ПЛАНИРОВАНИЕ ОТГРУЗКИ НА …». */
export function formatDailyReportDateLabel(date: Date): string {
  return formatRuDateWithWeekday(date, 'accusative');
}

/**
 * Текст Макс из live order_mixers (дашборд / fallback без интеллекта).
 * Тот же рендерер, что у кнопки «В Макс» — без второго формата.
 */
export function buildUnifiedLiveDayPlanText(opts: {
  dateLabel: string;
  groups: DailyReportOrderGroup[];
  onLineCount?: number;
  /** По умолчанию true — оперативный отчёт без выполненных. */
  excludeCompleted?: boolean;
}): string {
  const excludeCompleted = opts.excludeCompleted !== false;
  const plannedTrips: DailyReportPlannedTrip[] = [];
  for (const g of opts.groups) {
    for (const m of g.mixers) {
      plannedTrips.push({
        orderId: g.orderId,
        mixerNumber: m.number,
        volume: Number(m.volume) || 0,
        loadTime: m.time || '—',
        arriveTime: '—',
        returnTime: '—',
        factStatus: m.status || null,
      });
    }
  }
  const completedOrderIds = new Set(
    opts.groups
      .filter((g) => String(g.orderStatus || '').toLowerCase() === 'completed')
      .map((g) => String(g.orderId)),
  );
  return buildUnifiedDailyPlanText({
    dateLabel: opts.dateLabel,
    groups: opts.groups,
    plannedTrips,
    onLineCount: opts.onLineCount,
    excludeCompleted,
    completedOrderIds,
  });
}

/** @deprecated используй buildUnifiedLiveDayPlanText — оставлен как тонкая обёртка. */
export function buildDailyMixerReportText(opts: {
  dateLabel: string;
  groups: DailyReportOrderGroup[];
  /** Сколько рейсов сейчас «на линии» (для справки внизу). */
  onLineCount?: number;
  excludeCompleted?: boolean;
}): string {
  return buildUnifiedLiveDayPlanText(opts);
}

/** Рейс из интеллекта планирования — для вставки под заявку в отчёте Макс. */
export type DailyReportPlannedTrip = {
  orderId: number | string;
  mixerNumber: string;
  volume: number;
  loadTime: string;
  arriveTime: string;
  returnTime: string;
  /** Самовывоз: только соска, без «на объекте / обратно» */
  pickup?: boolean;
  /** Фаза 5 closed-loop: блок факта в тексте «В Макс» */
  factStatus?: string | null;
  factLoadStart?: string | null;
  factRelease?: string | null;
  factVolume?: number | null;
  deltaLoadMin?: number | null;
  deltaReleaseMin?: number | null;
  noOperatorRecord?: boolean;
};

/**
 * Единый отчёт для Макс: карточки заявок + рейсы интеллекта под каждой,
 * одна сводка сверху (ориентир) и снизу (итоги). Без отдельного списка рейсов.
 */
export function buildUnifiedDailyPlanText(opts: {
  dateLabel: string;
  groups: DailyReportOrderGroup[];
  plannedTrips: DailyReportPlannedTrip[];
  /** Текст ориентира парка (из buildFleetHint). */
  fleetHintText?: string;
  warnings?: Array<{ message: string }>;
  onLineCount?: number;
  /** Только «новые» рейсы этапа — остальные заявки без плана интеллекта. */
  onlyPlannedOrderIds?: Set<string>;
  /**
   * Не печатать выполненные заявки в списке (для оперативной публикации в Макс).
   * В шапке остаётся краткая сводка «Выполнено: …».
   */
  excludeCompleted?: boolean;
  /** Доп. id выполненных (manualDone / прогресс по факту), кроме status=completed. */
  completedOrderIds?: Set<string>;
  /** Режим «Включая ночь» — строка в шапке отчёта. */
  allowNight?: boolean;
  /** Учёт матрицы пробок по часу. */
  useTraffic?: boolean;
  /** Фактическое открытие БСУ (мин от полуночи), если раньше 06:00. */
  plantOpenMinutes?: number;
  /** Сдвиги целей (вариант B) — для Макс. */
  orderShifts?: Array<{
    orderId: string;
    from: string;
    to: string;
    deltaMin: number;
  }>;
}): string {
  const {
    dateLabel,
    groups,
    plannedTrips,
    fleetHintText,
    warnings = [],
    onLineCount,
    onlyPlannedOrderIds,
    excludeCompleted = false,
    completedOrderIds,
    allowNight,
    useTraffic,
    orderShifts,
    plantOpenMinutes,
  } = opts;

  const nonCancelled = groups.filter(
    (g) => String(g.orderStatus || '').toLowerCase() !== 'cancelled',
  );
  const completedGroups = nonCancelled.filter((g) =>
    isCompletedReportGroup(g, completedOrderIds),
  );
  const doneIds = new Set(completedGroups.map((g) => String(g.orderId)));
  if (completedOrderIds) {
    for (const id of completedOrderIds) doneIds.add(String(id));
  }
  const activeGroups = excludeCompleted
    ? nonCancelled.filter((g) => !doneIds.has(String(g.orderId)))
    : nonCancelled;

  const byOrder = new Map<string, DailyReportPlannedTrip[]>();
  for (const t of plannedTrips) {
    if (onlyPlannedOrderIds && !onlyPlannedOrderIds.has(String(t.orderId))) continue;
    if (excludeCompleted && doneIds.has(String(t.orderId))) continue;
    const key = String(t.orderId);
    const list = byOrder.get(key) || [];
    list.push(t);
    byOrder.set(key, list);
  }
  for (const list of byOrder.values()) {
    list.sort((a, b) => String(a.loadTime).localeCompare(String(b.loadTime)));
  }

  let text = `ПЛАНИРОВАНИЕ ОТГРУЗКИ НА ${dateLabel}\n`;
  if (allowNight) {
    text += 'Режим: включая ночь\n';
  } else if (
    typeof plantOpenMinutes === 'number' &&
    Number.isFinite(plantOpenMinutes)
  ) {
    const h = Math.floor(plantOpenMinutes / 60);
    const m = Math.abs(plantOpenMinutes % 60);
    const openLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    text += `Режим: окно ${openLabel}–21:00 (возврат ≤ 21:00)`;
    if (plantOpenMinutes < 6 * 60) {
      text += ' — рано под утренние доставки';
    }
    text += '\n';
  } else {
    text += 'Режим: окно 06:00–21:00 (возврат ≤ 21:00)\n';
  }
  if (useTraffic) {
    text += 'Пробки: учёт по часу суток (утро/вечер ×1.25–1.35)\n';
  }
  if (fleetHintText) {
    text += `${fleetHintText}\n`;
  }
  if (orderShifts?.length) {
    const shifts = excludeCompleted
      ? orderShifts.filter((s) => !doneIds.has(String(s.orderId)))
      : orderShifts;
    if (shifts.length) {
      text += 'Сдвиги целей:\n';
      for (const s of shifts) {
        const sign = s.deltaMin >= 0 ? '+' : '';
        text += `• #${s.orderId}: цель ${s.from} → предложено ${s.to} (${sign}${s.deltaMin} мин)\n`;
      }
    }
  }

  if (excludeCompleted && completedGroups.length > 0) {
    const doneVol = completedGroups.reduce(
      (s, g) => s + (Number(g.orderVolume) || 0),
      0,
    );
    text += `Выполнено: ${formatRuZayavkiCount(completedGroups.length)} · ${Math.round(doneVol * 10) / 10} м³ — в списке ниже скрыты\n`;
  }
  text += `\n`;

  if (excludeCompleted && activeGroups.length === 0) {
    text += completedGroups.length > 0
      ? 'Все заявки дня выполнены — активных рейсов нет.\n\n'
      : 'Активных заявок нет.\n\n';
  }

  let tripCount = 0;
  let tripVolume = 0;
  let ordersWithoutMixers = 0;
  let globalTripNo = 0;

  activeGroups.forEach((group, index) => {
    const planned = byOrder.get(String(group.orderId)) || [];
    const usePlanned = planned.length > 0;
    const assignedVol = usePlanned
      ? planned.reduce((s, t) => s + Number(t.volume || 0), 0)
      : group.mixers.reduce((s, m) => s + Number(m.volume || 0), 0);
    const tripN = usePlanned ? planned.length : group.mixers.length;
    tripCount += tripN;
    tripVolume += assignedVol;
    if (tripN === 0) ordersWithoutMixers += 1;

    const statusRu = ORDER_STATUS_RU[group.orderStatus] || group.orderStatus || '—';
    const planVol = Number(group.orderVolume || 0);

    text += `${index + 1}) Заявка #${group.orderId} — ${group.client}\n`;
    text += `   Бетон: ${group.grade} • Время: ${group.deliveryTime} • план ${planVol} м³`;
    if (tripN > 0) {
      text += ` • рейсы ${Math.round(assignedVol * 10) / 10} м³`;
    }
    text += ` • ${statusRu}\n`;
    text += `   Адрес: ${group.address || 'не указан'}\n`;
    if (group.contactPhone || group.contactName) {
      const contactBits = [group.contactName, group.contactPhone].filter(Boolean);
      text += `   Контакт: ${contactBits.join(', ')}\n`;
    } else {
      text += `   Контакт: не указан\n`;
    }

    if (usePlanned) {
      for (const t of planned) {
        globalTripNo += 1;
        if (t.pickup || t.mixerNumber === PICKUP_LABEL) {
          text += `   ${globalTripNo}) самовывоз · ${t.volume} м³ · загрузка ${t.loadTime} · соска будет готова ~${t.arriveTime}\n`;
        } else {
          // loadTime/arriveTime уже с «(+1д)» при уходе за полночь
          text += `   ${globalTripNo}) ${t.mixerNumber} · ${t.volume} м³ · загрузка ${t.loadTime} · на объекте ${t.arriveTime} · обратно ~${t.returnTime}\n`;
        }
        // Блок факта (если есть live-матч)
        if (t.factStatus || t.factLoadStart || t.factRelease) {
          const bits: string[] = [];
          if (t.factStatus) bits.push(String(t.factStatus));
          if (t.factLoadStart) {
            const d =
              t.deltaLoadMin != null && t.deltaLoadMin !== 0
                ? ` (${t.deltaLoadMin > 0 ? '+' : ''}${t.deltaLoadMin} мин)`
                : '';
            bits.push(`старт ${t.factLoadStart}${d}`);
          }
          if (t.factRelease) {
            const d =
              t.deltaReleaseMin != null && t.deltaReleaseMin !== 0
                ? ` (${t.deltaReleaseMin > 0 ? '+' : ''}${t.deltaReleaseMin} мин)`
                : '';
            bits.push(`выпуск ${t.factRelease}${d}`);
          }
          if (t.factVolume != null && Number.isFinite(t.factVolume)) {
            bits.push(`${t.factVolume} м³`);
          }
          if (t.noOperatorRecord) bits.push('без записи пульта');
          text += `      факт: ${bits.join(' · ')}\n`;
        }
      }
    } else if (group.mixers.length === 0) {
      text += `   (миксеры ещё не назначены)\n`;
    } else {
      group.mixers.forEach((mixer, i) => {
        text += `   ${i + 1}) ${mixer.number} — ${mixer.time} • ${mixer.volume} м³ • ${mixer.status}\n`;
      });
    }
    text += `\n`;
  });

  text += `———\n`;
  text += `Заявок: ${activeGroups.length}`;
  if (ordersWithoutMixers > 0) {
    text += ` (без миксеров: ${ordersWithoutMixers})`;
  }
  text += `\n`;
  text += `Рейсов: ${tripCount} • объём рейсов: ${Math.round(tripVolume * 10) / 10} м³\n`;
  if (typeof onLineCount === 'number') {
    text += `Сейчас на линии: ${onLineCount} миксеров\n`;
  }

  if (warnings.length > 0) {
    text += `\n⚠ Замечания планировщика (${warnings.length}):\n`;
    for (const w of warnings) {
      text += `• ${w.message}\n`;
    }
  }

  return text.trim() + '\n';
}

const SECTION_START_RE = /^(\d+)\)\s+Заявка\s+#(\d+)/;
const MIXER_LINE_RE = /^(\s+)(\d+)\)\s+(\S+)\s+—/;

type ParsedSection = { orderId: string; lines: string[] };

type ParsedReport = {
  header: string;
  sections: ParsedSection[];
  footer: string;
};

function normalizeMixerKey(name: string): string {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function parseDailyReport(text: string): ParsedReport {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const headerLines: string[] = [];
  const sections: ParsedSection[] = [];
  let i = 0;

  while (i < lines.length) {
    if (SECTION_START_RE.test(lines[i])) break;
    if (lines[i].startsWith('———') || lines[i].startsWith('Заявок:')) {
      return {
        header: headerLines.join('\n').trimEnd(),
        sections: [],
        footer: lines.slice(i).join('\n').trimEnd(),
      };
    }
    headerLines.push(lines[i]);
    i += 1;
  }

  while (i < lines.length) {
    if (lines[i].startsWith('———') || lines[i].startsWith('Заявок:')) {
      return {
        header: headerLines.join('\n').trimEnd(),
        sections,
        footer: lines.slice(i).join('\n').trimEnd(),
      };
    }
    const m = lines[i].match(SECTION_START_RE);
    if (!m) {
      i += 1;
      continue;
    }
    const orderId = m[2];
    const secLines = [lines[i]];
    i += 1;
    while (i < lines.length) {
      if (
        SECTION_START_RE.test(lines[i]) ||
        lines[i].startsWith('———') ||
        lines[i].startsWith('Заявок:')
      ) {
        break;
      }
      secLines.push(lines[i]);
      i += 1;
    }
    sections.push({ orderId, lines: secLines });
  }

  return {
    header: headerLines.join('\n').trimEnd(),
    sections,
    footer: '',
  };
}

function renumberMixerLines(lines: string[]): string[] {
  let n = 1;
  return lines.map((line) => {
    if (!MIXER_LINE_RE.test(line)) return line;
    return line.replace(
      MIXER_LINE_RE,
      (_full, indent: string, _oldN: string, name: string) => `${indent}${n++}) ${name} —`
    );
  });
}

/** Синхронизировать авто-строку (Бетон/Адрес/Контакт) в черновике. */
function syncPrefixedLine(edited: string[], autoLines: string[], prefix: string): string[] {
  const autoLine = autoLines.find((l) => l.trimStart().startsWith(prefix));
  if (!autoLine) return edited;
  const idx = edited.findIndex((l) => l.trimStart().startsWith(prefix));
  if (idx >= 0) {
    edited[idx] = autoLine;
    return edited;
  }
  // Вставляем после блока мета-строк (Бетон/Адрес/Контакт), чтобы порядок не ломался
  let insertAt = 1;
  for (let i = 0; i < edited.length; i++) {
    const t = edited[i].trimStart();
    if (t.startsWith('Бетон:') || t.startsWith('Адрес:') || t.startsWith('Контакт:')) {
      insertAt = i + 1;
    }
  }
  edited.splice(insertAt, 0, autoLine);
  return edited;
}

/**
 * Слить блок заявки: правки пользователя сохранить, новые рейсы из auto добавить,
 * строки «Бетон: / Адрес: / Контакт:» обновить по свежим данным.
 */
function mergeSectionLines(editedLines: string[], autoLines: string[]): string[] {
  let edited = [...editedLines];
  edited = syncPrefixedLine(edited, autoLines, 'Бетон:');
  edited = syncPrefixedLine(edited, autoLines, 'Адрес:');
  edited = syncPrefixedLine(edited, autoLines, 'Контакт:');

  const autoMixers = autoLines.filter((l) => MIXER_LINE_RE.test(l));
  if (autoMixers.length > 0) {
    for (let i = edited.length - 1; i >= 0; i--) {
      if (edited[i].includes('миксеры ещё не назначены')) {
        edited.splice(i, 1);
      }
    }
  }

  const existing = new Set<string>();
  for (const line of edited) {
    const m = line.match(MIXER_LINE_RE);
    if (m) existing.add(normalizeMixerKey(m[3]));
  }

  const toAdd = autoMixers.filter((line) => {
    const m = line.match(MIXER_LINE_RE);
    if (!m) return false;
    return !existing.has(normalizeMixerKey(m[3]));
  });

  if (toAdd.length === 0) return renumberMixerLines(edited);

  // Вставляем после последнего рейса — свободные заметки остаются внизу блока.
  let insertAt = -1;
  for (let i = 0; i < edited.length; i++) {
    if (MIXER_LINE_RE.test(edited[i])) insertAt = i + 1;
  }
  if (insertAt < 0) {
    insertAt = edited.length;
    while (insertAt > 0 && edited[insertAt - 1].trim() === '') insertAt -= 1;
    const metaIdx = edited.findIndex((l) => l.trimStart().startsWith('Бетон:'));
    if (metaIdx >= 0) insertAt = Math.max(insertAt, metaIdx + 1);
  }
  const merged = [...edited.slice(0, insertAt), ...toAdd, ...edited.slice(insertAt)];
  return renumberMixerLines(merged);
}

/**
 * Подмешать свежий автоотчёт в сохранённый черновик без сброса ручных правок.
 * — новые заявки / рейсы добавляются;
 * — уже отредактированный текст по заявке сохраняется;
 * — шапка и итоги берутся из свежего auto;
 * — если черновика нет или он = прошлому auto → просто nextAuto.
 */
export function mergeDailyReportDraft(
  previousAuto: string | null | undefined,
  edited: string | null | undefined,
  nextAuto: string
): string {
  const next = String(nextAuto || '');
  const draft = String(edited || '').trim();
  if (!draft) return next;

  const prev = previousAuto != null ? String(previousAuto).trim() : null;
  if (prev != null && draft === prev) return next;
  if (prev != null && next.trim() === prev) return String(edited);

  const ed = parseDailyReport(String(edited));
  const au = parseDailyReport(next);
  if (au.sections.length === 0 && ed.sections.length === 0) {
    return draft === prev ? next : String(edited);
  }

  const edMap = new Map(ed.sections.map((s) => [s.orderId, s.lines]));
  const parts: string[] = [];
  parts.push((au.header || ed.header || 'ПЛАНИРОВАНИЕ ОТГРУЗКИ').trimEnd());
  parts.push('');

  let idx = 1;
  const used = new Set<string>();

  for (const sec of au.sections) {
    used.add(sec.orderId);
    const base = edMap.get(sec.orderId);
    const lines = base ? mergeSectionLines(base, sec.lines) : [...sec.lines];
    if (lines.length > 0 && SECTION_START_RE.test(lines[0])) {
      lines[0] = lines[0].replace(/^\d+\)/, `${idx})`);
    }
    idx += 1;
    parts.push(lines.join('\n').trimEnd());
    parts.push('');
  }

  for (const sec of ed.sections) {
    if (used.has(sec.orderId)) continue;
    let lines = [...sec.lines];
    if (lines.length > 0 && SECTION_START_RE.test(lines[0])) {
      lines[0] = lines[0].replace(/^\d+\)/, `${idx})`);
    }
    idx += 1;
    parts.push(lines.join('\n').trimEnd());
    parts.push('');
  }

  const footer = (au.footer || ed.footer || '').trimEnd();
  if (footer) {
    parts.push(footer);
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
