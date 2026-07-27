/**
 * Текст «Планирование отгрузки» для дашборда (колонка «Миксеры в работе»).
 * Диспетчер правит план и копирует в Макс для водителей.
 * Черновики — в localStorage, ключи dailyReport_* / dailyReport_auto_*.
 */

import { sortMixersByLogisticsTime } from '@/lib/mixerTimeSort';
import { resolveOrderReceivingContact } from '@/lib/orderContact';
import { formatRuDateWithWeekday, formatTimeHHMM } from '@/lib/ruLocale';

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
  const sortedOrders = [...opts.orders].sort((a, b) =>
    String(a.delivery_time || '00:00').localeCompare(String(b.delivery_time || '00:00'))
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

/** «субботу, 25 июля» — для шапки «ПЛАНИРОВАНИЕ ОТГРУЗКИ НА …». */
export function formatDailyReportDateLabel(date: Date): string {
  return formatRuDateWithWeekday(date, 'accusative');
}

export function buildDailyMixerReportText(opts: {
  dateLabel: string;
  groups: DailyReportOrderGroup[];
  /** Сколько рейсов сейчас «на линии» (для справки внизу). */
  onLineCount?: number;
}): string {
  const { dateLabel, groups, onLineCount } = opts;

  let text = `ПЛАНИРОВАНИЕ ОТГРУЗКИ НА ${dateLabel}\n\n`;

  let tripCount = 0;
  let tripVolume = 0;
  let ordersWithoutMixers = 0;

  groups.forEach((group, index) => {
    const assignedVol = group.mixers.reduce((sum, m) => sum + Number(m.volume || 0), 0);
    tripCount += group.mixers.length;
    tripVolume += assignedVol;
    if (group.mixers.length === 0) ordersWithoutMixers += 1;

    const statusRu = ORDER_STATUS_RU[group.orderStatus] || group.orderStatus || '—';
    const planVol = Number(group.orderVolume || 0);

    text += `${index + 1}) Заявка #${group.orderId} — ${group.client}\n`;
    text += `   Бетон: ${group.grade} • Время: ${group.deliveryTime} • план ${planVol} м³`;
    if (group.mixers.length > 0) {
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

    if (group.mixers.length === 0) {
      text += `   (миксеры ещё не назначены)\n`;
    } else {
      group.mixers.forEach((mixer, i) => {
        text += `   ${i + 1}) ${mixer.number} — ${mixer.time} • ${mixer.volume} м³ • ${mixer.status}\n`;
      });
    }
    text += `\n`;
  });

  text += `———\n`;
  text += `Заявок: ${groups.length}`;
  if (ordersWithoutMixers > 0) {
    text += ` (без миксеров: ${ordersWithoutMixers})`;
  }
  text += `\n`;
  text += `Рейсов: ${tripCount} • объём рейсов: ${Math.round(tripVolume * 10) / 10} м³\n`;
  if (typeof onLineCount === 'number') {
    text += `Сейчас на линии: ${onLineCount} миксеров\n`;
  }

  return text;
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
