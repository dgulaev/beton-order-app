/** Парсер отчётов АЗС Benza (Excel) + нормализация госномеров РФ. */

import ExcelJS from 'exceljs';

export type BenzaFuelRow = {
  atIso: string;
  plateRaw: string;
  plateNorm: string;
  liters: number;
  /** false = в отчёте только дата (суточный), время поставлено 12:00 МСК */
  hasTime: boolean;
};

export type BenzaParseResult = {
  rows: BenzaFuelRow[];
  periodLabel: string | null;
  skippedZero: number;
  skippedService: number;
};

/** Латиница → кириллица для «похожих» букв госномера РФ. */
const LAT_TO_CYR: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

export function normalizePlate(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase();
  s = s.replace(/[\s.\-_]/g, '');
  let out = '';
  for (const ch of s) {
    out += LAT_TO_CYR[ch] ?? ch;
  }
  return out;
}

export function benzaEventKey(plateNorm: string, atIso: string, liters: number): string {
  const L = Math.round(liters * 100) / 100;
  return `benza|${plateNorm}|${atIso}|${L}`;
}

/** Запись без точного времени (суточный отчёт → 12:00 МСК). */
export function isBenzaDateOnlyIso(atIso: string): boolean {
  return /T12:00:00(?:\.000)?\+03:00$/.test(atIso);
}

/** Date → строка ДД.ММ.ГГГГ[ ЧЧ:ММ:СС] в МСК (не UTC). */
function formatDateAsMoscow(d: Date): { text: string; hasTime: boolean } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const dd = parts.day;
  const mm = parts.month;
  const yyyy = parts.year;
  const hh = parts.hour === '24' ? '00' : parts.hour;
  const mi = parts.minute;
  const ss = parts.second;
  // Excel serial без времени часто даёт 00:00
  const hasTime = !(hh === '00' && mi === '00' && ss === '00');
  if (hasTime) {
    return { text: `${dd}.${mm}.${yyyy} ${hh}:${mi}:${ss}`, hasTime: true };
  }
  return { text: `${dd}.${mm}.${yyyy}`, hasTime: false };
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    return formatDateAsMoscow(v).text;
  }
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: string; richText?: Array<{ text?: string }> };
    if (o.result != null) return cellText(o.result);
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text || '').join('');
  }
  return String(v).trim();
}

function cellNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v && 'result' in v) {
    return cellNumber((v as { result: unknown }).result);
  }
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export type ParsedBenzaDate = { atIso: string; hasTime: boolean };

/** ДД.ММ.ГГГГ[ ЧЧ:ММ:СС] → ISO с +03:00 (завод). */
export function parseBenzaDateTime(raw: string): ParsedBenzaDate | null {
  const s = raw.trim();
  // 08.01.2026 08:45:35
  let m = s.match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    if (hh != null) {
      return {
        atIso: `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? '00'}+03:00`,
        hasTime: true,
      };
    }
    return {
      atIso: `${yyyy}-${mm}-${dd}T12:00:00+03:00`,
      hasTime: false,
    };
  }
  // ISO / прочее — интерпретируем через МСК
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const formatted = formatDateAsMoscow(new Date(t));
    return parseBenzaDateTime(formatted.text);
  }
  return null;
}

function isServiceRow(dateCell: string, plateCell: string): boolean {
  const d = dateCell.toLowerCase();
  const p = plateCell.toLowerCase();
  if (!dateCell && !plateCell) return true;
  if (/итого|страница|рукав|отчет|отчёт|организация|контроллер|дата/.test(d)) return true;
  if (/итого|страница|рукав|пользователь|кол-во|мерник/.test(p)) return true;
  if (/^nerud|^tradecom|дт\s*$/i.test(dateCell)) return true;
  return false;
}

type ColMap = { date: number; plate: number; liters: number };

/** По умолчанию: «Отпуск ГСМ…» — дата в A, пользователь в B, литры в G. */
const DEFAULT_COLS: ColMap = { date: 1, plate: 2, liters: 7 };

function detectCols(sheet: ExcelJS.Worksheet): ColMap {
  const maxR = Math.min(sheet.rowCount || 0, 40);
  for (let r = 1; r <= maxR; r++) {
    const row = sheet.getRow(r);
    let date = 0;
    let plate = 0;
    let liters = 0;
    for (let c = 1; c <= 15; c++) {
      const t = cellText(row.getCell(c).value).toLowerCase();
      if (!t) continue;
      if (!date && /дата/.test(t)) date = c;
      if (!plate && /пользователь|госномер|гос\.?\s*номер|тс|авто/.test(t)) plate = c;
      if (!liters && /кол-во|количество|литр|л\b/.test(t)) liters = c;
    }
    if (date && plate && liters) return { date, plate, liters };
  }
  return DEFAULT_COLS;
}

/**
 * Парсит xlsx Benza: детальный (дата+время) и суточный (только дата).
 * Колонки: Дата и время | Пользователь | … | Кол-во, л
 */
export async function parseBenzaFuelWorkbook(
  buffer: ArrayBuffer | Buffer | Uint8Array,
): Promise<BenzaParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ExcelJS.Buffer);

  const rows: BenzaFuelRow[] = [];
  let skippedZero = 0;
  let skippedService = 0;
  let periodLabel: string | null = null;
  const seen = new Set<string>();

  for (const sheet of wb.worksheets) {
    const cols = detectCols(sheet);
    const maxR = sheet.rowCount || 0;
    for (let r = 1; r <= maxR; r++) {
      const row = sheet.getRow(r);
      const dateCell = cellText(row.getCell(cols.date).value);
      const plateCell = cellText(row.getCell(cols.plate).value);
      const liters =
        cellNumber(row.getCell(cols.liters).value) ??
        cellNumber(row.getCell(cols.liters + 1).value) ??
        cellNumber(row.getCell(cols.liters + 2).value);

      const periodProbe = `${dateCell} ${plateCell}`;
      if (/отчетный период|отчётный период/i.test(periodProbe)) {
        periodLabel = dateCell || plateCell;
        skippedService += 1;
        continue;
      }

      if (isServiceRow(dateCell, plateCell)) {
        skippedService += 1;
        continue;
      }

      const parsedAt = parseBenzaDateTime(dateCell);
      if (!parsedAt) {
        skippedService += 1;
        continue;
      }

      const plateRaw = plateCell;
      const plateNorm = normalizePlate(plateRaw);
      if (!plateNorm || plateNorm.length < 4) {
        skippedService += 1;
        continue;
      }

      if (liters == null || !(liters > 0.05)) {
        skippedZero += 1;
        continue;
      }

      const litersR = Math.round(liters * 100) / 100;
      const key = benzaEventKey(plateNorm, parsedAt.atIso, litersR);
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        atIso: parsedAt.atIso,
        plateRaw,
        plateNorm,
        liters: litersR,
        hasTime: parsedAt.hasTime,
      });
    }
  }

  rows.sort((a, b) => a.atIso.localeCompare(b.atIso));
  return { rows, periodLabel, skippedZero, skippedService };
}

export type MixerPlate = { id: number; number: string };

export type PlateIndexResult = {
  index: Map<string, number>;
  /** Нормализованные номера, у которых >1 ТС в справочнике */
  duplicatePlates: string[];
};

export function buildPlateIndex(mixers: MixerPlate[]): PlateIndexResult {
  const index = new Map<string, number>();
  const seen = new Map<string, number>();
  const duplicatePlates: string[] = [];

  for (const m of mixers) {
    const norm = normalizePlate(m.number);
    if (!norm) continue;
    const prev = seen.get(norm);
    if (prev != null && prev !== m.id) {
      if (!duplicatePlates.includes(norm)) duplicatePlates.push(norm);
    }
    seen.set(norm, m.id);
    index.set(norm, m.id);
  }

  return { index, duplicatePlates };
}

export function matchMixerId(
  plateIndex: Map<string, number>,
  plateNorm: string,
): number | null {
  return plateIndex.get(plateNorm) ?? null;
}
