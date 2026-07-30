/**
 * Справочник видов техники и шаблонов моделей (Фаза 1 «Техника»).
 * ownership по-прежнему в колонке mixers.type: own | rented.
 * Головы (tractor_unit) + сцепки с прицепами — см. fleet_couples / formatCoupleLabel.
 * Тарифы единиц — lib/fleetTariffs.ts (ключи в specs).
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
    // subtype рендерится отдельно (выше модели); здесь — метрики по типу
    { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '3000' },
    { key: 'bucket_m3', label: 'Объём ковша', type: 'number', unit: 'м³', placeholder: '1.5' },
    { key: 'boom_reach_m', label: 'Длина стрелы', type: 'number', unit: 'м', placeholder: '20' },
    { key: 'pump_output_m3h', label: 'Производительность', type: 'number', unit: 'м³/ч', placeholder: '90' },
  ],
};

/** Типы спецтехники (поле specs.subtype). */
export const SPECIAL_SUBTYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'loader', label: 'Погрузчик' },
  { value: 'manipulator', label: 'Манипулятор' },
  { value: 'excavator', label: 'Экскаватор' },
  { value: 'crane', label: 'Кран' },
  { value: 'concrete_pump', label: 'Бетононасос' },
  { value: 'other', label: 'Прочая спецтехника' },
];

export function specialSubtypeLabel(subtype: string | null | undefined): string {
  const opt = SPECIAL_SUBTYPE_OPTIONS.find((o) => o.value === subtype);
  return opt?.label || 'Спецтехника';
}

/** Показывать ли общее поле volume («Грузоподъёмность, т») для спецтехники. */
export function specialShowsVolumeField(subtype: string | null | undefined): boolean {
  return String(subtype || 'other') === 'other';
}

/** Короткая метрика для карточки списка спецтехники. */
export function specialListMetric(
  volume: number | null | undefined,
  specs: Record<string, any> | null | undefined,
): string {
  const subtype = String(specs?.subtype || 'other');
  const lift = Number(specs?.lift_kg);
  const boom = Number(specs?.boom_reach_m);
  const bucket = Number(specs?.bucket_m3);
  const pump = Number(specs?.pump_output_m3h);
  if (subtype === 'concrete_pump') {
    const parts: string[] = [];
    if (Number.isFinite(boom) && boom > 0) parts.push(`${boom} м`);
    if (Number.isFinite(pump) && pump > 0) parts.push(`${pump} м³/ч`);
    return parts.join(' · ') || '—';
  }
  if (subtype === 'crane' || subtype === 'manipulator') {
    const parts: string[] = [];
    if (Number.isFinite(lift) && lift > 0) parts.push(`${lift >= 1000 ? `${lift / 1000} т` : `${lift} кг`}`);
    if (Number.isFinite(boom) && boom > 0) parts.push(`${boom} м`);
    return parts.join(' · ') || '—';
  }
  if (subtype === 'loader' || subtype === 'excavator') {
    const parts: string[] = [];
    if (Number.isFinite(lift) && lift > 0) parts.push(`${lift >= 1000 ? `${lift / 1000} т` : `${lift} кг`}`);
    if (Number.isFinite(bucket) && bucket > 0) parts.push(`${bucket} м³`);
    return parts.join(' · ') || '—';
  }
  const vol = Number(volume);
  if (Number.isFinite(vol) && vol > 0) return `${vol} т`;
  return '—';
}

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

/** Какие поля specs показывать в форме (без дубля volume; subtype — отдельно сверху). */
export function visibleSpecFields(kind: VehicleKind, specs: Record<string, any> | null | undefined): SpecField[] {
  const all = SPEC_FIELDS_BY_KIND[kind] || [];
  const mirrorKey = VOLUME_MIRROR_SPEC_KEY[kind];
  const withoutMirror = mirrorKey ? all.filter((f) => f.key !== mirrorKey) : all;
  if (kind !== 'special') return withoutMirror;

  const subtype = String(specs?.subtype || 'other');
  if (subtype === 'loader' || subtype === 'excavator') {
    return [
      { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '3000' },
      { key: 'bucket_m3', label: 'Объём ковша', type: 'number', unit: 'м³', placeholder: '1.5' },
    ];
  }
  if (subtype === 'manipulator') {
    return [
      { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '7000' },
      { key: 'boom_reach_m', label: 'Вылет стрелы', type: 'number', unit: 'м', placeholder: '12' },
    ];
  }
  if (subtype === 'crane') {
    return [
      { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '25000' },
      { key: 'boom_reach_m', label: 'Длина стрелы', type: 'number', unit: 'м', placeholder: '21' },
    ];
  }
  if (subtype === 'concrete_pump') {
    return [
      { key: 'boom_reach_m', label: 'Длина стрелы', type: 'number', unit: 'м', placeholder: '32' },
      { key: 'pump_output_m3h', label: 'Производительность', type: 'number', unit: 'м³/ч', placeholder: '90' },
    ];
  }
  // Прочая спецтехника — общие метрики
  return [
    { key: 'lift_kg', label: 'Грузоподъёмность', type: 'number', unit: 'кг', placeholder: '3000' },
    { key: 'boom_reach_m', label: 'Длина / вылет стрелы', type: 'number', unit: 'м', placeholder: '8' },
    { key: 'bucket_m3', label: 'Объём ковша', type: 'number', unit: 'м³', placeholder: '1.5' },
  ];
}

/** Шаблоны моделей спецтехники с фильтром по типу. */
export function modelTemplatesForKind(
  kind: VehicleKind,
  specs?: Record<string, any> | null,
): ModelTemplate[] {
  const all = MODEL_TEMPLATES[kind] || [];
  if (kind !== 'special') return all;
  const subtype = String(specs?.subtype || '');
  if (!subtype) return all;
  return all.filter((t) => !t.specs?.subtype || String(t.specs.subtype) === subtype);
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
    { model: 'Амкодор 342С', volume: 0, specs: { subtype: 'loader', lift_kg: 3400, bucket_m3: 1.7 } },
    { model: 'JCB 3CX', volume: 0, specs: { subtype: 'loader', lift_kg: 3200, bucket_m3: 1.1 } },
    { model: 'Hyundai HL760', volume: 0, specs: { subtype: 'loader', lift_kg: 5000, bucket_m3: 2.7 } },
    { model: 'КАМАЗ манипулятор', volume: 0, specs: { subtype: 'manipulator', lift_kg: 7000, boom_reach_m: 12 } },
    { model: 'МАЗ манипулятор', volume: 0, specs: { subtype: 'manipulator', lift_kg: 6000, boom_reach_m: 10 } },
    { model: 'JCB JS200', volume: 0, specs: { subtype: 'excavator', bucket_m3: 1.0, lift_kg: 12000 } },
    { model: 'КС-55713', volume: 0, specs: { subtype: 'crane', lift_kg: 25000, boom_reach_m: 21 } },
    { model: 'Галичанин КС-55729', volume: 0, specs: { subtype: 'crane', lift_kg: 32000, boom_reach_m: 30 } },
    {
      model: 'Putzmeister BSF 36.5',
      volume: 0,
      specs: {
        subtype: 'concrete_pump', boom_reach_m: 36, pump_output_m3h: 90,
        hour_rate_rub: 9000, min_shift_hours: 7, primer_mix_cost_rub: 5000,
      },
    },
    {
      model: 'Schwing S 36 X',
      volume: 0,
      specs: {
        subtype: 'concrete_pump', boom_reach_m: 36, pump_output_m3h: 100,
        hour_rate_rub: 9500, min_shift_hours: 7, primer_mix_cost_rub: 5500,
      },
    },
    {
      model: 'CIFA K36L',
      volume: 0,
      specs: {
        subtype: 'concrete_pump', boom_reach_m: 36, pump_output_m3h: 120,
        hour_rate_rub: 10000, min_shift_hours: 7, primer_mix_cost_rub: 6000,
      },
    },
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

/** Реэкспорт тарифов — единая точка для старых импортов из fleetCatalog. */
export { formatRub, concretePumpShiftTotal } from '@/lib/fleetTariffs';

export function formatSpecsSummary(kind: VehicleKind, specs: Record<string, any> | null | undefined): string {
  return formatSpecsChips(kind, specs)
    .map((c) => c.text)
    .join(' · ');
}

export type SpecChip = {
  text: string;
  /** accent — тип/подтип; muted — обычный параметр */
  tone?: 'accent' | 'muted';
};

/** Чипы характеристик для списка/плитки (читаемее, чем одна серая строка). */
export function formatSpecsChips(
  kind: VehicleKind,
  specs: Record<string, any> | null | undefined,
): SpecChip[] {
  const chips: SpecChip[] = [];
  if (kind === 'special' && specs?.subtype) {
    chips.push({ text: specialSubtypeLabel(String(specs.subtype)), tone: 'accent' });
  }
  if (!specs || typeof specs !== 'object') return chips;
  for (const f of visibleSpecFields(kind, specs)) {
    const v = specs[f.key];
    if (v === undefined || v === null || v === '' || v === 0) continue;
    const short =
      f.key === 'boom_reach_m'
        ? `Стрела ${v} м`
        : f.key === 'pump_output_m3h'
          ? `${v} м³/ч`
          : f.key === 'lift_kg'
            ? Number(v) >= 1000
              ? `Г/п ${Number(v) / 1000} т`
              : `Г/п ${v} кг`
            : f.key === 'bucket_m3'
              ? `Ковш ${v} м³`
              : f.key === 'payload_tons' || f.key === 'capacity_tons'
                ? `${v} т`
                : f.key === 'compartments'
                  ? `${v} отс.`
                  : f.key === 'axle_count'
                    ? `${v} оси`
                    : f.key === 'length_m'
                      ? `${v} м`
                      : f.unit
                        ? `${v} ${f.unit}`
                        : String(v);
    chips.push({ text: short, tone: 'muted' });
  }
  return chips;
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
