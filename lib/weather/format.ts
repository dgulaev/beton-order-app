/** Формат светового дня: «15 ч 42 мин» */
export function formatDaylightDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} ч ${String(m).padStart(2, '0')} мин`;
}
