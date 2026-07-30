/**
 * Справочник видов техники и шаблонов моделей (Фаза 1 «Техника»).
 * ownership по-прежнему в колонке mixers.type: own | rented.
 * Головы (tractor_unit) + сцепки с прицепами — см. fleet_couples / formatCoupleLabel.
 */

export type VehicleKind =
  | 'mixer'
  | 'dump_truck'
  | 'tonar'
  | 'cement_truck'
  | 'special'
  | 'tractor_unit';

export type Ownership = 'own' | 'rented';

export type SpecFieldType = 'number' | 'text' | 'select';

export type SpecField = {
  key: string;
  label: string;
  type: SpecFieldType;
  unit?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
};

export type ModelTemplate = {
  model: string;
  /** Колонка mixers.volume; для bulk-видов зеркалится в specs (см. VOLUME_MIRROR_SPEC_KEY) */
  volume?: number;
  specs?: Record<string, string | number>;
};

export const VEHICLE_KINDS: {
  key: VehicleKind;
  label: string;
  singular: string;
  addLabel: string;
  volumeLabel: string;
  volumeUnit: string;
}[] = [
  { key: 'mixer', label: 'Миксеры', singular: 'Миксер', addLabel: '+ Добавить миксер', volumeLabel: 'Объём', volumeUnit: 'м³' },
  { key: 'dump_truck', label: 'Самосвалы', singular: 'Самосвал', addLabel: '+ Добавить самосвал', volumeLabel: 'Объём кузова', volumeUnit: 'м³' },
  { key: 'tonar', label: 'Тоннары', singular: 'Тоннар', addLabel: '+ Добавить тоннар', volumeLabel: 'Грузоподъёмность', volumeUnit: 'т' },
  { key: 'cement_truck', label: 'Цементовозы', singular: 'Цементовоз', addLabel: '+ Добавить цементовоз', volumeLabel: 'Ёмкость', volumeUnit: 'т' },
  { key: 'tractor_unit', label: 'Головы', singular: 'Голова', addLabel: '+ Добавить голову', volumeLabel: '—', volumeUnit: '' },
  { key: 'special', label: 'Спецтехника', singular: 'Спецтехника', addLabel: '+ Добавить технику', volumeLabel: 'Грузоподъёмность', volumeUnit: 'т' },
];

/** Виды прицепов, которые можно сцеплять с головой. */
export const TRAILER_KINDS: VehicleKind[] = ['tonar', 'cement_truck'];

export function isTrailerKind(v: unknown): v is VehicleKind {
  return v === 'tonar' || v === 'cement_truck';
}

export function vehicleKindMeta(kind: VehicleKind) {
  return VEHICLE_KINDS.find((k) => k.key === kind) || VEHICLE_KINDS[0];
}

export function isVehicleKind(v: unknown): v is VehicleKind {
  return VEHICLE_KINDS.some((k) => k.key === v);
}

/**
 * Spec-ключ, который дублирует колонку mixers.volume (и подпись volumeLabel).
 * В форме не показываем — volume остаётся единственным полем; в specs пишем при сохранении.
 */
export const VOLUME_MIRROR_SPEC_KEY: Partial<Record<VehicleKind, string>> = {
  dump_truck: 'body_volume_m3',
  tonar: 'payload_tons',
  cement_truck: 'capacity_tons',
};

/** Поля specs по виду техники. */
export const SPEC_FIELDS_BY_KIND: Record<VehicleKind, SpecField[]> = {
  mixer: [],
  tractor_unit: [],
  dump_truck: [
    { key: 'payload_tons', label: 'Грузоподъёмность', type: 'number', unit: 'т', placeholder: '25' },
    { key: 'body_volume_m3', label: 'Объём кузова', type: 'number', unit: 'м³', placeholder: '16' },
    { key: 'axle_count', label: 'Осей', type: 'number', placeholder: '3' },
  ],
  tonar: [
    { key: 'payload_tons', label: 'Грузоподъёмность', type: 'number', unit: 'т', placeholder: '40' },
    { key: 'length_m', label: 'Длина платформы', type: 'number', unit: 'м', placeholder: '13.6' },
  ],
  cement_truck: [
    { key: 'capacity_tons', label: 'Ёмкость', type: 'number', unit: 'т', placeholder: '30' },
    { key: 'compartments', label: 'Отсеков', type: 'number', placeholder: '1' },
  ],
  special: [
    {
      key: 'subtype',
      label: 'Подтип',
      type: 'select',
      options: [
        { value: 'loader', label: 'Погрузчик' },
        { value: 'manipulator', label: 'Манипулятор' },
        { value: 'excavator', label: 'Экскаватор' },
        { value: 'other', label: 'Прочее' },
      ],
    },
    { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '3000' },
    { key: 'bucket_m3', label: 'Объём ковша', type: 'number', unit: 'м³', placeholder: '1.5' },
    { key: 'boom_reach_m', label: 'Вылет стрелы', type: 'number', unit: 'м', placeholder: '8' },
  ],
};

/** Записать volume в зеркальный ключ specs (чтобы JSON и колонка не расходились). */
export function syncVolumeIntoSpecs(
  kind: VehicleKind,
  volume: number | string | null | undefined,
  specs: Record<string, any> | null | undefined,
): Record<string, any> {
  const out: Record<string, any> = { ...(specs && typeof specs === 'object' ? specs : {}) };
  const mirrorKey = VOLUME_MIRROR_SPEC_KEY[kind];
  if (!mirrorKey) return out;
  const n = Number(volume);
  if (Number.isFinite(n)) out[mirrorKey] = n;
  return out;
}

/** Какие поля specs показывать в форме (без дубля volume). */
export function visibleSpecFields(kind: VehicleKind, specs: Record<string, any> | null | undefined): SpecField[] {
  const all = SPEC_FIELDS_BY_KIND[kind] || [];
  const mirrorKey = VOLUME_MIRROR_SPEC_KEY[kind];
  const withoutMirror = mirrorKey ? all.filter((f) => f.key !== mirrorKey) : all;
  if (kind !== 'special') return withoutMirror;
  const subtype = String(specs?.subtype || 'other');
  return withoutMirror.filter((f) => {
    if (f.key === 'subtype') return true;
    if (subtype === 'loader') return f.key === 'lift_kg' || f.key === 'bucket_m3';
    if (subtype === 'manipulator') return f.key === 'lift_kg' || f.key === 'boom_reach_m';
    if (subtype === 'excavator') return f.key === 'bucket_m3' || f.key === 'lift_kg';
    return f.key === 'lift_kg' || f.key === 'bucket_m3' || f.key === 'boom_reach_m';
  });
}

/** Шаблоны моделей — при выборе подставляем volume + specs. */
export const MODEL_TEMPLATES: Record<VehicleKind, ModelTemplate[]> = {
  mixer: [
    { model: 'КАМАЗ 5814', volume: 8 },
    { model: 'КАМАЗ 58142', volume: 9 },
    { model: 'КАМАЗ 58147', volume: 10 },
    { model: 'Tigarbo', volume: 10 },
    { model: 'АБС-10', volume: 10 },
    { model: 'АБС-12', volume: 12 },
  ],
  dump_truck: [
    { model: 'Howo ZZ3257', volume: 16, specs: { payload_tons: 25, body_volume_m3: 16, axle_count: 3 } },
    { model: 'Howo ZZ3327', volume: 20, specs: { payload_tons: 30, body_volume_m3: 20, axle_count: 4 } },
    { model: 'КАМАЗ 65115', volume: 15, specs: { payload_tons: 15, body_volume_m3: 15, axle_count: 3 } },
    { model: 'КАМАЗ 6520', volume: 20, specs: { payload_tons: 20, body_volume_m3: 20, axle_count: 3 } },
    { model: 'МАЗ 6501', volume: 16, specs: { payload_tons: 20, body_volume_m3: 16, axle_count: 3 } },
    { model: 'Shacman F3000', volume: 25, specs: { payload_tons: 25, body_volume_m3: 25, axle_count: 4 } },
  ],
  tonar: [
    // Прицеп под сцепку с головой (водитель не нужен)
    { model: 'Тоннар (прицеп)', volume: 40, specs: { payload_tons: 40, length_m: 13.6 } },
    { model: 'Тоннар 33 т (прицеп)', volume: 33, specs: { payload_tons: 33, length_m: 12 } },
    { model: 'Тоннар 45 т (прицеп)', volume: 45, specs: { payload_tons: 45, length_m: 13.6 } },
    { model: 'Тонар-9523', volume: 40, specs: { payload_tons: 40, length_m: 13.6 } },
    { model: 'Тонар-95234', volume: 45, specs: { payload_tons: 45, length_m: 13.6 } },
    { model: 'Тонар-9989', volume: 33, specs: { payload_tons: 33, length_m: 12 } },
  ],
  cement_truck: [
    // Чистая бочка-прицеп под сцепку с головой (водитель не нужен)
    { model: 'Бочка (прицеп)', volume: 30, specs: { capacity_tons: 30, compartments: 1 } },
    { model: 'Бочка 20 т (прицеп)', volume: 20, specs: { capacity_tons: 20, compartments: 1 } },
    { model: 'Бочка 32 т (прицеп)', volume: 32, specs: { capacity_tons: 32, compartments: 2 } },
    // Моноблок — машина целиком (есть свой водитель), без головы
    { model: 'КАМАЗ 65115 Ц (моноблок)', volume: 14, specs: { capacity_tons: 14, compartments: 1 } },
    { model: 'КАМАЗ 6520 Ц (моноблок)', volume: 20, specs: { capacity_tons: 20, compartments: 1 } },
    { model: 'МАЗ цементовоз (моноблок)', volume: 30, specs: { capacity_tons: 30, compartments: 2 } },
    { model: 'Howo цементовоз (моноблок)', volume: 35, specs: { capacity_tons: 35, compartments: 2 } },
  ],
  tractor_unit: [
    { model: 'SITRAK', volume: 0 },
    { model: 'Volvo', volume: 0 },
    { model: 'КАМАЗ тягач', volume: 0 },
    { model: 'МАЗ тягач', volume: 0 },
  ],
  special: [
    { model: 'Амкодор 342С', volume: 3, specs: { subtype: 'loader', lift_kg: 3400, bucket_m3: 1.7 } },
    { model: 'JCB 3CX', volume: 1, specs: { subtype: 'loader', lift_kg: 3200, bucket_m3: 1.1 } },
    { model: 'Hyundai HL760', volume: 3, specs: { subtype: 'loader', lift_kg: 5000, bucket_m3: 2.7 } },
    { model: 'КАМАЗ манипулятор', volume: 7, specs: { subtype: 'manipulator', lift_kg: 7000, boom_reach_m: 12 } },
    { model: 'МАЗ манипулятор', volume: 6, specs: { subtype: 'manipulator', lift_kg: 6000, boom_reach_m: 10 } },
    { model: 'JCB JS200', volume: 1, specs: { subtype: 'excavator', bucket_m3: 1.0, lift_kg: 0 } },
  ],
};

export function applyModelTemplate(
  kind: VehicleKind,
  modelName: string
): { volume?: number; specs: Record<string, string | number> } | null {
  const t = (MODEL_TEMPLATES[kind] || []).find(
    (m) => m.model.toLowerCase() === String(modelName || '').trim().toLowerCase()
  );
  if (!t) return null;
  return { volume: t.volume, specs: { ...(t.specs || {}) } };
}

export function formatSpecsSummary(kind: VehicleKind, specs: Record<string, any> | null | undefined): string {
  if (!specs || typeof specs !== 'object') return '';
  const fields = visibleSpecFields(kind, specs);
  const parts: string[] = [];
  for (const f of fields) {
    if (f.key === 'subtype') {
      const opt = f.options?.find((o) => o.value === specs.subtype);
      if (opt) parts.push(opt.label);
      continue;
    }
    const v = specs[f.key];
    if (v === undefined || v === null || v === '' || v === 0) continue;
    parts.push(`${f.label}: ${v}${f.unit ? ` ${f.unit}` : ''}`);
  }
  return parts.join(' · ');
}

/** Короткая подпись прицепа для сцепки: «бочка 30 т» / «тоннар 40 т». */
export function trailerKindShortLabel(kind: string | null | undefined, volume?: number | null): string {
  const vol = Number(volume);
  const volPart = Number.isFinite(vol) && vol > 0 ? ` ${String(vol).replace(/\.0+$/, '')} т` : '';
  if (kind === 'cement_truck') return `бочка${volPart}`;
  if (kind === 'tonar') return `тоннар${volPart}`;
  return `прицеп${volPart}`;
}

/** Подпись сцепки: «SITRAK K123AB32 + бочка 30 т». */
export function formatCoupleLabel(opts: {
  tractorModel?: string | null;
  tractorNumber?: string | null;
  trailerKind?: string | null;
  trailerVolume?: number | null;
  trailerNumber?: string | null;
}): string {
  const head = [opts.tractorModel, opts.tractorNumber].filter(Boolean).join(' ').trim() || 'Голова';
  const trailer = trailerKindShortLabel(opts.trailerKind, opts.trailerVolume);
  const trailerNum = opts.trailerNumber ? ` (${opts.trailerNumber})` : '';
  return `${head} + ${trailer}${trailerNum}`;
}

/** Нужны ли водитель/телефон для вида (прицеп-бочка может быть без водителя). */
export function vehicleRequiresDriver(kind: VehicleKind): boolean {
  return kind === 'mixer' || kind === 'tractor_unit' || kind === 'dump_truck' || kind === 'special';
}
