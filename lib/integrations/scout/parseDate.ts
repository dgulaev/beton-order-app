/** Парсит /Date(1785840294000+0300)/ или ISO → ISO string */
export function parseScoutDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(raw);
  if (m) return new Date(Number(m[1])).toISOString();
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}
