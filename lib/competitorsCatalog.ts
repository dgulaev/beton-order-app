/**
 * Справочник бетонных заводов Брянска (Фаза 6).
 * Координаты — ориентир площадки/офиса (WGS84), для точек погрузки и карты.
 * name / short_name — как на сайтах конкурентов (short_name → матрица).
 */

export type CompetitorSeed = {
  /** Стабильный ключ для upsert / parser_key */
  key: string;
  name: string;
  short_name: string;
  /** Старые имена в БД — чтобы sync нашёл карточку после переименования */
  former_names?: string[];
  website: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  sort_order: number;
  /** null = только ручной ввод */
  parser_key: string | null;
  price_url?: string | null;
  notes?: string | null;
  /** Создать партнёрскую точку погрузки бетона */
  asLoadingPoint?: boolean;
};

export const BRYANSK_COMPETITORS: CompetitorSeed[] = [
  {
    key: 'bzkpd',
    name: 'БСК Индустрия',
    short_name: 'БСК Индустрия',
    former_names: ['УК БЗКПД', 'БЗКПД'],
    website: 'https://bsk-industry.ru/',
    phone: '+7 (4832) 32-12-85',
    address: 'г. Брянск, ул. Речная, 99А',
    lat: 53.2432,
    lon: 34.3645,
    sort_order: 10,
    parser_key: 'bzkpd',
    price_url: 'https://bsk-industry.ru/catalog',
    notes: 'bsk-industry.ru. Прайс: /tovarnyi_beton + /tovarnyi_rastvor',
    asLoadingPoint: true,
  },
  {
    key: 'strojservis',
    name: 'АО «Стройсервис»',
    short_name: 'СтройСервис',
    former_names: ['Стройсервис'],
    website: 'https://strojservis.ru/',
    phone: '+7 (4832) 77-03-99',
    address: 'г. Брянск / пр-во Карачев',
    lat: 53.2525,
    lon: 34.3658,
    sort_order: 20,
    parser_key: 'strojservis',
    price_url: 'https://strojservis.ru/catalog/tovarnyy_beton_i_rastvor/',
    notes: 'Прайс: /tovarnyy_beton + /tovarnyy_rastvor. гр.=гранит, изв.=известняк.',
    asLoadingPoint: true,
  },
  {
    key: 'ecson',
    name: 'Евробетон (ЕКСОН)',
    short_name: 'Евробетон',
    former_names: ['ЕКСОН (ЕвроБетон)', 'ЕКСОН'],
    website: 'https://ecson32.ru/',
    phone: '+7 (4832) 33-60-60',
    address: 'п. Свень-Транспортная, ул. Зелёный Бор, 36',
    lat: 53.1998,
    lon: 34.3812,
    sort_order: 30,
    parser_key: 'ecson',
    price_url: 'https://ecson32.ru/pricelist',
    notes: 'ООО «Бетонэкс» / ecson32.ru. Прайс /pricelist.',
    asLoadingPoint: true,
  },
  {
    key: 'delobeton',
    name: 'Деловой бетон',
    short_name: 'Деловой бетон',
    former_names: ['Деловой Бетон'],
    website: 'https://delobeton.ru/',
    phone: '+7 (910) 333-53-10',
    address: 'Брянский р-н, с. Октябрьское, ул. Придорожная, 1А',
    lat: 53.2795,
    lon: 34.2788,
    sort_order: 40,
    parser_key: 'delobeton',
    price_url: 'https://delobeton.ru/caenad.html',
    notes: 'Прайс caenad.html: растворы + бетон только на граните (колонок «и» на сайте нет).',
    asLoadingPoint: true,
  },
  {
    key: 'megabeton',
    name: 'Мегаполис',
    short_name: 'Мегаполис',
    former_names: ['МегаБетон (Мегаполис)', 'МегаБетон', 'Мегабетон'],
    website: 'https://megapolis-beton.ru/',
    phone: '+7 (4832) 30-55-55',
    address: 'Брянский р-н, с. Толмачево, ул. Трудовая, 54',
    lat: 53.2346,
    lon: 34.2894,
    sort_order: 50,
    parser_key: 'megapolis',
    price_url: 'https://megapolis-beton.ru/',
    notes: 'ООО «Мегаполис-Снаб». Гравий → изв.; цена без ПМД.',
    asLoadingPoint: true,
  },
  {
    key: 'specbeton',
    name: 'СпецБетон',
    short_name: 'СпецБетон',
    former_names: ['Спецбетон'],
    website: 'https://specbeton32.ru/',
    phone: null,
    address: 'г. Брянск',
    lat: 53.2520,
    lon: 34.3710,
    sort_order: 60,
    parser_key: 'specbeton',
    price_url: 'https://specbeton32.ru/',
    notes: 'Прайс на главной: гравий/гранит + раствор. Гравий → изв.',
    asLoadingPoint: true,
  },
  {
    key: 'masterbeton',
    name: 'МастерБетон',
    short_name: 'МастерБетон',
    former_names: ['Мастер Бетон'],
    website: 'https://www.master-beton32.ru/',
    phone: '+7 (4832) 37-70-76',
    address: 'пос. Большое Полпино, ул. Инженерная, 13',
    lat: 53.2891,
    lon: 34.4186,
    sort_order: 80,
    parser_key: 'masterbeton',
    price_url: 'https://www.master-beton32.ru/',
    notes: 'Прайс: только гранит + раствор (известняка на сайте нет).',
    asLoadingPoint: true,
  },
  {
    key: 'elitbeton',
    name: 'ДСК «Элит Бетон»',
    short_name: 'ЭлитБетон',
    former_names: ['Элит бетон', 'Элитбетон'],
    website: 'https://элитбетон32.рф/',
    phone: '+7 (4832) 301-750',
    address: 'г. Брянск, ул. Вокзальная, 128 / стр. 128А',
    lat: 53.2142,
    lon: 34.4038,
    sort_order: 90,
    parser_key: 'elitbeton',
    price_url: 'https://xn--32-9kcqnrrh7ac9i.xn--p1ai/',
    notes: 'Прайс /beton/+/rastvor/. Весь бетон на граните (П3); раствор отдельно.',
    asLoadingPoint: true,
  },
  {
    key: 'skbetonstroy',
    name: 'СК БЕТОН СТРОЙ',
    short_name: 'СК БЕТОН СТРОЙ',
    website: null,
    phone: null,
    address: null,
    // Ориентир Брянск (уточнить при появлении площадки)
    lat: 53.2521,
    lon: 34.3717,
    sort_order: 100,
    parser_key: null,
    notes: 'Сайта нет — только ручной ввод. Координаты ориентировочные — уточнить.',
    asLoadingPoint: true,
  },
];

/** Закрытые / убранные из матрицы — sync деактивирует. */
export const COMPETITORS_DEACTIVATE_NAMES = [
  'ПромСтройБетон',
  'ПромСтройБетон (Нефтика)',
  'Нефтика',
];

export function competitorSeedByKey(key: string): CompetitorSeed | undefined {
  return BRYANSK_COMPETITORS.find((c) => c.key === key);
}

/** URL прайса для клика в матрице (отдельное окно). */
export function resolveCompetitorPriceUrl(c: {
  parser_key?: string | null;
  name?: string | null;
  short_name?: string | null;
  website?: string | null;
}): string | null {
  const seed =
    (c.parser_key
      ? BRYANSK_COMPETITORS.find((s) => s.parser_key === c.parser_key)
      : undefined) ||
    BRYANSK_COMPETITORS.find(
      (s) =>
        s.name === c.name ||
        s.short_name === c.short_name ||
        (c.name && s.former_names?.includes(c.name)) ||
        (c.short_name && s.former_names?.includes(c.short_name))
    );
  const url = seed?.price_url || seed?.website || c.website || null;
  return url ? String(url).trim() || null : null;
}
