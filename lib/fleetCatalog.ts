/**
 * Справочник видов техники и шаблонов моделей (Фаза 1 «Техника»).
 * ownership по-прежнему в колонке mixers.type: own | rented.
 */

export type VehicleKind = 'mixer' | 'dump_truck' | 'tonar' | 'cement_truck' | 'special';

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
  /** Подставляется в volume (для миксера — м³, для остальных часто дублирует payload) */
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
  { key: 'special', label: 'Спецтехника', singular: 'Спецтехника', addLabel: '+ Добавить технику', volumeLabel: 'Грузоподъёмность', volumeUnit: 'т' },
];

export function vehicleKindMeta(kind: VehicleKind) {
  return VEHICLE_KINDS.find((k) => k.key === kind) || VEHICLE_KINDS[0];
}

export function isVehicleKind(v: unknown): v is VehicleKind {
  return VEHICLE_KINDS.some((k) => k.key === v);
}

/** Поля specs по виду техники. */
export const SPEC_FIELDS_BY_KIND: Record<VehicleKind, SpecField[]> = {
  mixer: [],
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

/** Какие поля specs показывать для спецтехники с учётом subtype. */
export function visibleSpecFields(kind: VehicleKind, specs: Record<string, any> | null | undefined): SpecField[] {
  const all = SPEC_FIELDS_BY_KIND[kind] || [];
  if (kind !== 'special') return all;
  const subtype = String(specs?.subtype || 'other');
  return all.filter((f) => {
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
    { model: 'Тонар-9523', volume: 40, specs: { payload_tons: 40, length_m: 13.6 } },
    { model: 'Тонар-95234', volume: 45, specs: { payload_tons: 45, length_m: 13.6 } },
    { model: 'Тонар-9989', volume: 33, specs: { payload_tons: 33, length_m: 12 } },
  ],
  cement_truck: [
    { model: 'КАМАЗ 65115 Ц', volume: 14, specs: { capacity_tons: 14, compartments: 1 } },
    { model: 'КАМАЗ 6520 Ц', volume: 20, specs: { capacity_tons: 20, compartments: 1 } },
    { model: 'МАЗ цементовоз', volume: 30, specs: { capacity_tons: 30, compartments: 2 } },
    { model: 'Howo цементовоз', volume: 35, specs: { capacity_tons: 35, compartments: 2 } },
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
