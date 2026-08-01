/**
 * Даты отчётов MEKA: в Excel/сырых строках почти всегда ДД.ММ.ГГГГ (или ДД.ММ.ГГ).
 * Нельзя кормить это в Date.parse / new Date — получится MM.DD (американский порядок).
 */

/** Привести дату MEKA к YYYY-MM-DD. null — если разобрать нельзя. */
export function parseMekaDateToIso(raw: unknown): string | null {
  if (raw == null) return null;

  // Excel serial (редко, если xlsx отдал число)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    // Excel epoch 1899-12-30
    const utc = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Уже ISO / Postgres date
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (!isValidYmd(y, m, d)) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // ДД.ММ.ГГГГ или ДД.ММ.ГГ
  const dotted = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    let year = Number(dotted[3]);
    if (dotted[3].length === 2) {
      // Контекст завода: 2000–2099
      year = 2000 + year;
    }
    if (!isValidYmd(year, month, day)) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

/** Дата отчёта для фильтра/графика: сначала Excel (raw_data), потом report_date. */
export function getMekaReportDateIso(report: {
  report_date?: string | null;
  raw_data?: Array<{ date?: unknown }> | null;
}): string | null {
  const fromExcel = parseMekaDateToIso(report?.raw_data?.[0]?.date);
  if (fromExcel) return fromExcel;
  return parseMekaDateToIso(report?.report_date);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}
