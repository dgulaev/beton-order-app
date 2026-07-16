// Общие формулы для испытаний бетона по ГОСТ 10180-2012.
// Используются и в модалке «Новое испытание», и в протоколе — чтобы прочность
// считалась одинаково в обоих местах.

export interface Specimen {
  mass: number | '';   // масса кубика, г
  load: number | '';   // разрушающая нагрузка, кН
}

// Масштабный коэффициент α — приведение к базовому кубу 150 мм.
export const SCALE: Record<number, number> = { 70: 0.85, 100: 0.95, 150: 1.0, 200: 1.05, 300: 1.1 };

export const num = (v: unknown): number =>
  typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0;

export const ru = (v: number, digits = 2): string =>
  Number.isFinite(v) ? v.toFixed(digits).replace('.', ',') : '';

export const ruInt = (v: number): string => (Number.isFinite(v) ? String(Math.round(v)) : '');

export interface SeriesRow {
  mass: number;
  load: number;
  strength: number;   // прочность кубика, МПа
  density: number;    // плотность кубика, кг/м³
}

export interface SeriesResult {
  size: number;
  rows: SeriesRow[];
  avgStrength: number;
  avgDensity: number;
  percent: number;    // % от заданной (для 7 сут)
  pass: boolean;      // соответствие классу (для 28 сут)
  design: number;
}

// Прочность кубика = нагрузка(Н) / площадь(мм²) × α.
// Плотность = масса(кг) / объём(м³).
export function computeSeries(
  specimens: Specimen[],
  cubeSize: number,
  designStrength: unknown
): SeriesResult {
  const size = Number(cubeSize) || 100;
  const scale = SCALE[size] ?? 1;
  const area = size * size;                 // мм²
  const volCm3 = Math.pow(size / 10, 3);    // см³
  const rows: SeriesRow[] = (specimens || []).map((s) => {
    const mass = num(s.mass);
    const load = num(s.load);
    const strength = load > 0 ? ((load * 1000) / area) * scale : 0;
    const density = mass > 0 ? (mass * 1000) / volCm3 : 0;
    return { mass, load, strength, density };
  });
  const valid = rows.filter((r) => r.strength > 0);
  const avgStrength = valid.length ? valid.reduce((a, r) => a + r.strength, 0) / valid.length : 0;
  const dens = rows.filter((r) => r.density > 0);
  const avgDensity = dens.length ? dens.reduce((a, r) => a + r.density, 0) / dens.length : 0;
  const design = num(designStrength);
  const percent = design > 0 && avgStrength > 0 ? Math.round((avgStrength / design) * 100) : 0;
  const pass = design > 0 ? avgStrength >= design : false;
  return { size, rows, avgStrength, avgDensity, percent, pass, design };
}
