/**
 * Системные настройки adminCifra (таблица system_settings, id=1).
 * Дефолты = текущие hardcode-значения в коде.
 */

import { ROUTE_ORIGIN_ADDRESS } from '@/lib/bryanskAddress';
import { ROUTE_ORIGIN_COORDS } from '@/lib/geocodeAddress';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';
import {
  PLANT_WEATHER_LABEL,
  PLANT_WEATHER_LAT,
  PLANT_WEATHER_LON,
} from '@/lib/weather/plant';

export const NAV_SECTIONS = [
  'dashboard',
  'planning',
  'zayavki',
  'sales',
  'recipes',
  'mixers',
  'loading_points',
  'competitors',
  'clients',
  'tasks',
  'operator',
  'online',
  'settings',
] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

export const NAV_SECTION_LABELS: Record<NavSection, string> = {
  dashboard: 'Диспетчерская',
  planning: 'Планирование',
  zayavki: 'Заявки',
  sales: 'Продажи',
  recipes: 'Лаборатория',
  mixers: 'Техника',
  loading_points: 'Точки погрузки',
  competitors: 'Конкуренты',
  clients: 'Клиенты',
  tasks: 'Задачи',
  operator: 'Оператор БСУ',
  online: 'Кто в онлайн',
  settings: 'Настройки',
};

export const STAFF_ROLES_FOR_ACCESS = [
  'admin',
  'manager',
  'dispatcher',
  'operator',
  'laborant',
  'mehanik',
] as const;

export type StaffRoleKey = (typeof STAFF_ROLES_FOR_ACCESS)[number];

/** Роли × разделы — как сейчас в layout (до появления страницы Настройки). */
export const DEFAULT_ROLE_ACCESS: Record<NavSection, StaffRoleKey[]> = {
  dashboard: ['admin', 'manager', 'dispatcher'],
  planning: ['admin', 'manager', 'dispatcher', 'operator'],
  zayavki: ['admin', 'manager', 'dispatcher'],
  sales: ['admin', 'manager', 'dispatcher'],
  recipes: ['admin', 'manager', 'dispatcher', 'laborant'],
  mixers: ['admin', 'manager', 'dispatcher', 'mehanik'],
  loading_points: ['admin', 'manager', 'dispatcher'],
  competitors: ['admin', 'manager', 'dispatcher'],
  clients: ['admin', 'manager', 'dispatcher'],
  tasks: ['admin', 'manager', 'dispatcher'],
  operator: ['admin', 'manager', 'dispatcher', 'operator'],
  online: ['admin'],
  settings: ['admin'],
};

export type SystemBannerSettings = {
  enabled: boolean;
  title: string;
  body: string;
  /** YYYY-MM-DD или пусто */
  expiresAt: string | null;
};

/** Бамп при добавлении ролей с дефолтами в матрице — одноразовый seed в merge. */
export const ROLE_ACCESS_SCHEMA_VERSION = 2;

export type SystemSettingsData = {
  notifications: {
    muteSound: boolean;
    muteToasts: boolean;
    channelToasts: boolean;
    channelMax: boolean;
    /** Роли, которым показывают тосты по заявкам */
    orderToastRoles: StaffRoleKey[];
  };
  plant: {
    address: string;
    lat: number;
    lon: number;
    weatherLat: number;
    weatherLon: number;
    weatherLabel: string;
  };
  logistics: {
    delayMinutesThreshold: number;
    ownUnloadAllowanceMin: number;
  };
  warehouse: {
    lowRateTonsSilo12: number;
    lowRateTonsSilo3: number;
  };
  interface: {
    sidebarCollapsedDefault: boolean;
    banner: SystemBannerSettings;
  };
  roleAccess: Record<NavSection, StaffRoleKey[]>;
  /** Версия матрицы ролей (миграции дефолтов новых ролей). */
  roleAccessSchemaVersion: number;
};

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsData = {
  notifications: {
    muteSound: false,
    muteToasts: false,
    channelToasts: true,
    channelMax: true,
    orderToastRoles: ['admin', 'manager', 'dispatcher', 'operator'],
  },
  plant: {
    address: ROUTE_ORIGIN_ADDRESS,
    lat: ROUTE_ORIGIN_COORDS.lat,
    lon: ROUTE_ORIGIN_COORDS.lon,
    weatherLat: PLANT_WEATHER_LAT,
    weatherLon: PLANT_WEATHER_LON,
    weatherLabel: PLANT_WEATHER_LABEL,
  },
  logistics: {
    delayMinutesThreshold: 15,
    ownUnloadAllowanceMin: OWN_UNLOAD_ALLOWANCE_MIN,
  },
  warehouse: {
    /** Силосы ~75 т (1/2): алерт при минусе глубже −5 т */
    lowRateTonsSilo12: 5,
    /** Силос ~150 т (3): алерт при минусе глубже −10 т */
    lowRateTonsSilo3: 10,
  },
  interface: {
    sidebarCollapsedDefault: true,
    banner: {
      enabled: false,
      title: '',
      body: '',
      expiresAt: null,
    },
  },
  roleAccess: { ...DEFAULT_ROLE_ACCESS },
  roleAccessSchemaVersion: ROLE_ACCESS_SCHEMA_VERSION,
};

function isStaffRole(v: unknown): v is StaffRoleKey {
  return typeof v === 'string' && (STAFF_ROLES_FOR_ACCESS as readonly string[]).includes(v);
}

function mergeRoleAccess(
  raw: unknown,
  base: Record<NavSection, StaffRoleKey[]> = DEFAULT_ROLE_ACCESS,
  schemaVersion = 0,
): Record<NavSection, StaffRoleKey[]> {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') {
    out.settings = ['admin'];
    return out;
  }
  const obj = raw as Record<string, unknown>;
  for (const section of NAV_SECTIONS) {
    // Настройки — только admin (страница и PUT так же)
    if (section === 'settings') {
      out.settings = ['admin'];
      continue;
    }
    const list = obj[section];
    if (!Array.isArray(list)) continue;
    out[section] = list.filter(isStaffRole);
  }

  // v2: роль mehanik — по умолчанию только «Техника» (одноразово, пока schema < 2).
  if (schemaVersion < 2) {
    for (const section of NAV_SECTIONS) {
      if (section === 'settings') continue;
      if (DEFAULT_ROLE_ACCESS[section].includes('mehanik') && !out[section].includes('mehanik')) {
        out[section] = [...out[section], 'mehanik'];
      }
    }
  }

  return out;
}

/** Координаты завода: отклоняем 0/пусто/вне разумного bbox РФ → fallback. */
function sanePlantCoord(value: unknown, fallback: number, kind: 'lat' | 'lon'): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Number('') === 0 — типичный баг очистки input type=number
  if (Math.abs(n) < 0.01) return fallback;
  if (kind === 'lat' && (n < 41 || n > 82)) return fallback;
  if (kind === 'lon' && (n < 19 || n > 190)) return fallback;
  return n;
}

function finiteNonNeg(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

/**
 * Глубокий merge JSON с базой (по умолчанию — дефолты приложения).
 * Для PUT передавай текущую строку из БД вторым аргументом, иначе частичный body
 * затрёт остальные секции дефолтами.
 */
export function mergeSystemSettings(
  raw: unknown,
  base: SystemSettingsData = DEFAULT_SYSTEM_SETTINGS,
): SystemSettingsData {
  const d = base;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const n = r.notifications && typeof r.notifications === 'object' ? r.notifications : {};
  const p = r.plant && typeof r.plant === 'object' ? r.plant : {};
  const l = r.logistics && typeof r.logistics === 'object' ? r.logistics : {};
  const w = r.warehouse && typeof r.warehouse === 'object' ? r.warehouse : {};
  const ui = r.interface && typeof r.interface === 'object' ? r.interface : {};
  const banner = ui.banner && typeof ui.banner === 'object' ? ui.banner : {};

  const orderToastRoles = Array.isArray(n.orderToastRoles)
    ? n.orderToastRoles.filter(isStaffRole)
    : d.notifications.orderToastRoles;

  // Версия: из raw (БД / полный PUT). Если в partial PUT версии нет — из base
  // (уже загруженные settings). При merge(DB, DEFAULT) base === DEFAULT → 0,
  // чтобы одноразовый seed новых ролей всё ещё сработал на старой БД.
  const rawSchema = r.roleAccessSchemaVersion;
  const parsedSchema = Number(rawSchema);
  const hasRawSchema =
    rawSchema !== undefined && rawSchema !== null && rawSchema !== '' && Number.isFinite(parsedSchema);
  const baseSchema = Number(d.roleAccessSchemaVersion);
  const schemaVersion = hasRawSchema
    ? parsedSchema
    : base === DEFAULT_SYSTEM_SETTINGS
      ? 0
      : Number.isFinite(baseSchema)
        ? baseSchema
        : 0;

  return {
    notifications: {
      muteSound: Boolean(n.muteSound ?? d.notifications.muteSound),
      muteToasts: Boolean(n.muteToasts ?? d.notifications.muteToasts),
      channelToasts: n.channelToasts !== undefined ? Boolean(n.channelToasts) : d.notifications.channelToasts,
      channelMax: n.channelMax !== undefined ? Boolean(n.channelMax) : d.notifications.channelMax,
      orderToastRoles: orderToastRoles.length ? orderToastRoles : d.notifications.orderToastRoles,
    },
    plant: {
      address: String(p.address ?? d.plant.address).trim() || d.plant.address,
      lat: sanePlantCoord(p.lat !== undefined ? p.lat : d.plant.lat, d.plant.lat, 'lat'),
      lon: sanePlantCoord(p.lon !== undefined ? p.lon : d.plant.lon, d.plant.lon, 'lon'),
      weatherLat: sanePlantCoord(
        p.weatherLat !== undefined ? p.weatherLat : d.plant.weatherLat,
        d.plant.weatherLat,
        'lat',
      ),
      weatherLon: sanePlantCoord(
        p.weatherLon !== undefined ? p.weatherLon : d.plant.weatherLon,
        d.plant.weatherLon,
        'lon',
      ),
      weatherLabel: String(p.weatherLabel ?? d.plant.weatherLabel),
    },
    logistics: {
      delayMinutesThreshold: Math.max(
        1,
        Number(l.delayMinutesThreshold) || d.logistics.delayMinutesThreshold,
      ),
      ownUnloadAllowanceMin: Math.max(
        1,
        Number(l.ownUnloadAllowanceMin) || d.logistics.ownUnloadAllowanceMin,
      ),
    },
    warehouse: {
      lowRateTonsSilo12: finiteNonNeg(w.lowRateTonsSilo12, d.warehouse.lowRateTonsSilo12),
      lowRateTonsSilo3: finiteNonNeg(w.lowRateTonsSilo3, d.warehouse.lowRateTonsSilo3),
    },
    interface: {
      sidebarCollapsedDefault:
        ui.sidebarCollapsedDefault !== undefined
          ? Boolean(ui.sidebarCollapsedDefault)
          : d.interface.sidebarCollapsedDefault,
      banner: {
        enabled: Boolean(banner.enabled ?? d.interface.banner.enabled),
        title: String(banner.title ?? d.interface.banner.title ?? ''),
        body: String(banner.body ?? d.interface.banner.body ?? ''),
        expiresAt:
          banner.expiresAt !== undefined
            ? banner.expiresAt
              ? String(banner.expiresAt)
              : null
            : d.interface.banner.expiresAt,
      },
    },
    roleAccess: mergeRoleAccess(r.roleAccess, d.roleAccess, schemaVersion),
    // После seed всегда фиксируем актуальную версию — снятие галочек больше не откатывается.
    roleAccessSchemaVersion: Math.max(schemaVersion, ROLE_ACCESS_SCHEMA_VERSION),
  };
}

export function bannerDismissStorageKey(banner: SystemBannerSettings): string {
  return `adminCifraBannerDismiss:${banner.title}|${banner.body}|${banner.expiresAt || ''}`;
}

export function canAccessNavSection(
  role: string | null | undefined,
  section: NavSection,
  roleAccess: Record<NavSection, StaffRoleKey[]> = DEFAULT_ROLE_ACCESS,
): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  if (r === 'admin') return true;
  const allowed = roleAccess[section] || DEFAULT_ROLE_ACCESS[section];
  return allowed.map((x) => x.toLowerCase()).includes(r);
}

export function isBannerActive(banner: SystemBannerSettings, now = new Date()): boolean {
  if (!banner.enabled) return false;
  const title = banner.title.trim();
  const body = banner.body.trim();
  if (!title && !body) return false;
  if (banner.expiresAt) {
    const end = new Date(`${banner.expiresAt}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && now > end) return false;
  }
  return true;
}

/** Pathname → секция меню (для редиректов по roleAccess). */
export function pathnameToNavSection(pathname: string | null | undefined): NavSection | null {
  if (!pathname) return null;
  if (pathname.startsWith('/adminCifra/settings')) return 'settings';
  if (pathname.startsWith('/adminCifra/dashboard')) return 'dashboard';
  if (pathname.startsWith('/adminCifra/planning')) return 'planning';
  if (pathname.startsWith('/adminCifra/zayavki')) return 'zayavki';
  if (
    pathname.startsWith('/adminCifra/leads') ||
    pathname.startsWith('/adminCifra/marketplace') ||
    pathname.startsWith('/adminCifra/demand') ||
    pathname.startsWith('/adminCifra/callout') ||
    pathname.startsWith('/adminCifra/integrations')
  ) {
    return 'sales';
  }
  if (pathname.startsWith('/adminCifra/recipes')) return 'recipes';
  if (pathname.startsWith('/adminCifra/mixers') || pathname.startsWith('/adminCifra/technika')) {
    return 'mixers';
  }
  if (pathname.startsWith('/adminCifra/loading-points')) return 'loading_points';
  if (pathname.startsWith('/adminCifra/competitors')) return 'competitors';
  if (pathname.startsWith('/adminCifra/clients')) return 'clients';
  if (pathname.startsWith('/adminCifra/tasks')) return 'tasks';
  if (pathname.startsWith('/adminCifra/operator')) return 'operator';
  if (pathname.startsWith('/adminCifra/online')) return 'online';
  return null;
}

export const SIDEBAR_COLLAPSED_PREF_KEY = 'adminCifraSidebarCollapsed';
