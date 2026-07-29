/**
 * Справочник заводов-поставщиков цемента (каталог «Продукция» → Цемент).
 *
 * Координаты — WGS 84, центр промышленной площадки по OpenStreetMap
 * (Nominatim lookup / GEM).
 *
 * Точки погрузки: сиды в scripts/loading-points.sql (external_key cement:…).
 */

export type CementPlantId = 'fokino_cemros' | 'kostyukovichi_bcz' | 'krichev_kcsh';

export type CementPlant = {
  id: CementPlantId;
  /** Короткое имя для UI */
  shortName: string;
  legalName: string;
  holding: string;
  country: 'RU' | 'BY';
  /** Юридический / контактный адрес */
  address: string;
  /** Широта / долгота площадки завода */
  lat: number;
  lon: number;
  /** Источник координат */
  coordsSource: string;
  osmWayId?: number;
  website?: string;
  /** Мощность, тыс. т/год (заявленная производителем, ориентир) */
  capacityKtPerYear?: number;
};

export const CEMENT_SUPPLIER_PLANTS: CementPlant[] = [
  {
    id: 'fokino_cemros',
    shortName: 'Фокино (ЦЕМРОС)',
    legalName: 'АО «Мальцовский портландцемент»',
    holding: 'ЦЕМРОС',
    country: 'RU',
    address: '242610, Россия, Брянская обл., г. Фокино, ул. Цементников, д. 1',
    lat: 53.44599,
    lon: 34.41237,
    coordsSource: 'OSM way «ЗАО Мальцовский портландцемент» (Nominatim); GEM ≈ 53.44510, 34.40760',
    website: 'https://cemros.ru/about/geography/factories/maltsovskiy-portlandtsement/',
    capacityKtPerYear: 2348,
  },
  {
    id: 'kostyukovichi_bcz',
    shortName: 'Костюковичи (БЦЗ)',
    legalName: 'ОАО «Белорусский цементный завод»',
    holding: 'Белорусская цементная компания (БЦК)',
    country: 'BY',
    address: '213640, Беларусь, Могилёвская обл., г. Костюковичи, ул. Юношеская, 117',
    // Площадка завода — юго-западнее города (Забычанский с/с), не точка юрадреса в центре.
    lat: 53.39073,
    lon: 32.01319,
    coordsSource: 'OSM way/314217719 «Беларускі цэментны завод»; GEM ≈ 53.39241, 32.01227',
    osmWayId: 314217719,
    website: 'https://belcement.by/',
    capacityKtPerYear: 2100,
  },
  {
    id: 'krichev_kcsh',
    shortName: 'Кричев (КЦШ)',
    legalName: 'ОАО «Кричевцементношифер»',
    holding: 'Белорусская цементная компания (БЦК)',
    country: 'BY',
    address:
      '213493, Беларусь, Могилёвская обл., Кричевский р-н, Краснобудский с/с, 2 (АБК у м/р «Каменка»)',
    lat: 53.72933,
    lon: 31.72396,
    coordsSource: 'OSM way/50826786 «ОАО Кричевцементношифер»',
    osmWayId: 50826786,
    website: 'https://kcsh.by/',
    capacityKtPerYear: 1500,
  },
];

export function getCementPlant(id: CementPlantId): CementPlant | undefined {
  return CEMENT_SUPPLIER_PLANTS.find((p) => p.id === id);
}

/** Курс ЦБ РФ: 1 BYN → RUB (обновлять по необходимости). */
export const BYN_TO_RUB_RATE = 27.2538;
export const BYN_TO_RUB_RATE_AS_OF = '29.07.2026';

/** Перевод бел. руб. → рос. руб. (округление до целых ₽). */
export function bynToRub(byn: number, rate: number = BYN_TO_RUB_RATE): number {
  if (!Number.isFinite(byn) || byn <= 0) return 0;
  return Math.round(byn * rate);
}

/** Перевод рос. руб. → бел. руб. (2 знака после запятой). */
export function rubToByn(rub: number, rate: number = BYN_TO_RUB_RATE): number {
  if (!Number.isFinite(rub) || rub <= 0 || !rate) return 0;
  return Math.round((rub / rate) * 100) / 100;
}

/**
 * Цена цемента к отображению в ₽.
 * Если у белорусского завода в БД ещё лежит исходная цена в Br
 * (обычно < 2000), конвертируем по курсу; иначе считаем, что уже ₽.
 */
export function cementPriceRub(
  price: number,
  plantId: CementPlantId | null | undefined
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const plant = plantId ? getCementPlant(plantId) : undefined;
  if (plant?.country === 'BY' && price < 2000) return bynToRub(price);
  return Math.round(price);
}
