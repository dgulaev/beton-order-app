/** Чистые экстракторы объёма/марки — без supabase / settings (можно в client). */

export function extractVolume(text: string): number | null {
  const m = text.match(/(\d+[.,]?\d*)\s*(м3|м³|куб|м\^3)/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

export function normalizeGrade(g: string): string {
  return g.replace(/\s+/g, '').toUpperCase().replace(/^M/, 'М');
}

export function extractGrades(text: string): string[] {
  const found = new Set<string>();
  // \b плохо работает с кириллицей — границы вручную.
  const re = /(^|[^A-Za-zА-Яа-яЁё0-9])(М\s*\d{2,3}|M\s*\d{2,3}|В\s*\d{1,2}(?:[.,]\d)?)(?=[^A-Za-zА-Яа-яЁё0-9]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    found.add(normalizeGrade(m[2]));
  }
  return Array.from(found);
}
