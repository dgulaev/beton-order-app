import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type IntegrationSettingsRow = {
  id: number;
  avito_enabled: boolean;
  avito_client_id: string | null;
  avito_client_secret: string | null;
  avito_user_id: string | null;
  avito_webhook_secret: string | null;
  /** Легальный спрос из Messenger (не поиск чужих объявлений). */
  avito_demand_messenger?: boolean;
  gosplan_enabled: boolean;
  gosplan_base_url: string | null;
  gosplan_api_key: string | null;
  gosplan_regions: string | null;
  demand_demo: boolean;
  demand_feed_url: string | null;
  demand_home_regions: string | null;
  demand_min_volume_m3: number | null;
  demand_alert_score: number | null;
  updated_at?: string;
};

export type EffectiveIntegrationSettings = {
  avito: {
    enabled: boolean;
    clientId: string | null;
    clientSecret: string | null;
    userId: string | null;
    webhookSecret: string | null;
    configured: boolean;
    /** Входящие чаты → карточки Спроса (официальный Messenger API). */
    demandFromMessenger: boolean;
  };
  gosplan: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string | null;
    regions: string;
  };
  demand: {
    demo: boolean;
    feedUrl: string | null;
    homeRegions: string;
    minVolumeM3: number | null;
    alertScore: number;
  };
  /** Сырая строка БД (или null, если таблицы ещё нет). */
  db: IntegrationSettingsRow | null;
};

const CACHE_TTL_MS = 15_000;
let cache: { data: EffectiveIntegrationSettings; at: number } | null = null;

function pickStr(dbVal: string | null | undefined, envVal: string | undefined): string | null {
  const fromDb = dbVal?.trim();
  if (fromDb) return fromDb;
  const fromEnv = envVal?.trim();
  return fromEnv || null;
}

function envBoolOn(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null || raw.trim() === '') return defaultOn;
  const v = raw.trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return defaultOn;
}

/** Только env — пока кэш пуст или таблица недоступна. */
export function envOnlyIntegrationSettings(): EffectiveIntegrationSettings {
  const clientId = process.env.AVITO_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.AVITO_CLIENT_SECRET?.trim() || null;
  const userId = process.env.AVITO_USER_ID?.trim() || null;
  const webhookSecret = process.env.AVITO_WEBHOOK_SECRET?.trim() || null;
  const avitoEnabled = true;

  return {
    avito: {
      enabled: avitoEnabled,
      clientId,
      clientSecret,
      userId,
      webhookSecret,
      configured: Boolean(avitoEnabled && clientId && clientSecret && userId),
      demandFromMessenger: process.env.AVITO_DEMAND_MESSENGER === '1',
    },
    gosplan: {
      enabled: envBoolOn(process.env.GOSPLAN_ENABLED, true),
      baseUrl: (process.env.GOSPLAN_BASE_URL || 'https://v2test.gosplan.info').replace(/\/$/, ''),
      apiKey: process.env.GOSPLAN_API_KEY?.trim() || null,
      regions: process.env.GOSPLAN_REGIONS?.trim() || '32',
    },
    demand: {
      demo: process.env.DEMAND_DEMO === '1',
      feedUrl: process.env.DEMAND_FEED_URL?.trim() || null,
      homeRegions: process.env.DEMAND_HOME_REGIONS?.trim() || 'брянск,брянская',
      minVolumeM3: process.env.DEMAND_MIN_VOLUME_M3
        ? Number(process.env.DEMAND_MIN_VOLUME_M3)
        : null,
      alertScore: Number(process.env.DEMAND_ALERT_SCORE || 60) || 60,
    },
    db: null,
  };
}

function mergeRow(row: IntegrationSettingsRow | null): EffectiveIntegrationSettings {
  const base = envOnlyIntegrationSettings();
  if (!row) return base;

  const clientId = pickStr(row.avito_client_id, process.env.AVITO_CLIENT_ID);
  const clientSecret = pickStr(row.avito_client_secret, process.env.AVITO_CLIENT_SECRET);
  const userId = pickStr(row.avito_user_id, process.env.AVITO_USER_ID);
  const webhookSecret = pickStr(row.avito_webhook_secret, process.env.AVITO_WEBHOOK_SECRET);
  // Тумблеры из БД — источник истины (env остаётся fallback только без строки таблицы).
  const avitoEnabled = row.avito_enabled !== false;
  const gosplanEnabled = row.gosplan_enabled !== false;

  return {
    avito: {
      enabled: avitoEnabled,
      clientId,
      clientSecret,
      userId,
      webhookSecret,
      configured: Boolean(avitoEnabled && clientId && clientSecret && userId),
      // Если колонка уже в строке — тумблер из БД; иначе fallback на env.
      demandFromMessenger:
        typeof row.avito_demand_messenger === 'boolean'
          ? row.avito_demand_messenger
          : process.env.AVITO_DEMAND_MESSENGER === '1',
    },
    gosplan: {
      enabled: gosplanEnabled,
      baseUrl: (
        pickStr(row.gosplan_base_url, process.env.GOSPLAN_BASE_URL) ||
        'https://v2test.gosplan.info'
      ).replace(/\/$/, ''),
      apiKey: pickStr(row.gosplan_api_key, process.env.GOSPLAN_API_KEY),
      regions:
        pickStr(row.gosplan_regions, process.env.GOSPLAN_REGIONS) || '32',
    },
    demand: {
      // Тумблер демо — только из БД (иначе env DEMAND_DEMO=1 нельзя выключить из UI).
      demo: row.demand_demo === true,
      feedUrl: pickStr(row.demand_feed_url, process.env.DEMAND_FEED_URL),
      homeRegions:
        pickStr(row.demand_home_regions, process.env.DEMAND_HOME_REGIONS) ||
        'брянск,брянская',
      minVolumeM3:
        row.demand_min_volume_m3 != null && Number.isFinite(Number(row.demand_min_volume_m3))
          ? Number(row.demand_min_volume_m3)
          : base.demand.minVolumeM3,
      alertScore:
        row.demand_alert_score != null && Number.isFinite(Number(row.demand_alert_score))
          ? Number(row.demand_alert_score)
          : base.demand.alertScore,
    },
    db: row,
  };
}

export function invalidateIntegrationSettingsCache() {
  cache = null;
}

/** Синхронный peek: кэш или env-only (без ожидания БД). */
export function peekIntegrationSettings(): EffectiveIntegrationSettings {
  return cache?.data ?? envOnlyIntegrationSettings();
}

export async function getIntegrationSettings(
  force = false,
): Promise<EffectiveIntegrationSettings> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('integration_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      // Таблицы ещё нет — тихо падаем на env.
      if (error.code !== '42P01' && !/does not exist|relation/i.test(error.message)) {
        console.warn('[integrations] settings load:', error.message);
      }
      const fallback = envOnlyIntegrationSettings();
      cache = { data: fallback, at: Date.now() };
      return fallback;
    }

    const merged = mergeRow((data as IntegrationSettingsRow | null) ?? null);
    cache = { data: merged, at: Date.now() };
    return merged;
  } catch (e) {
    console.warn('[integrations] settings load failed', e);
    const fallback = envOnlyIntegrationSettings();
    cache = { data: fallback, at: Date.now() };
    return fallback;
  }
}

export type IntegrationSettingsPatch = {
  avito_enabled?: boolean;
  avito_client_id?: string | null;
  /** undefined = не трогать; null/'' = очистить (вернуться к env) */
  avito_client_secret?: string | null;
  avito_user_id?: string | null;
  avito_webhook_secret?: string | null;
  avito_demand_messenger?: boolean;
  gosplan_enabled?: boolean;
  gosplan_base_url?: string | null;
  gosplan_api_key?: string | null;
  gosplan_regions?: string | null;
  demand_demo?: boolean;
  demand_feed_url?: string | null;
  demand_home_regions?: string | null;
  demand_min_volume_m3?: number | null;
  demand_alert_score?: number | null;
};

function normalizeOptionalText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Сохранить патч. Пустые секреты в body без ключа clear_* — не затирают. */
export async function saveIntegrationSettings(
  patch: IntegrationSettingsPatch,
): Promise<EffectiveIntegrationSettings> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof patch.avito_enabled === 'boolean') row.avito_enabled = patch.avito_enabled;
  if (typeof patch.avito_demand_messenger === 'boolean') {
    row.avito_demand_messenger = patch.avito_demand_messenger;
  }
  if (typeof patch.gosplan_enabled === 'boolean') row.gosplan_enabled = patch.gosplan_enabled;
  if (typeof patch.demand_demo === 'boolean') row.demand_demo = patch.demand_demo;

  const textKeys = [
    'avito_client_id',
    'avito_user_id',
    'gosplan_base_url',
    'gosplan_regions',
    'demand_feed_url',
    'demand_home_regions',
  ] as const;

  for (const key of textKeys) {
    if (key in patch) {
      row[key] = normalizeOptionalText(patch[key]);
    }
  }

  // Секреты: undefined = не менять; null или '' = очистить override
  for (const key of ['avito_client_secret', 'avito_webhook_secret', 'gosplan_api_key'] as const) {
    if (key in patch) {
      row[key] = normalizeOptionalText(patch[key]);
    }
  }

  if ('demand_min_volume_m3' in patch) {
    const n = patch.demand_min_volume_m3;
    if (n == null || n === ('' as unknown)) {
      row.demand_min_volume_m3 = null;
    } else {
      const num = Number(n);
      if (!Number.isFinite(num)) {
        throw new Error('Мин. объём: некорректное число');
      }
      row.demand_min_volume_m3 = num;
    }
  }
  if ('demand_alert_score' in patch) {
    const n = patch.demand_alert_score;
    if (n == null || n === ('' as unknown)) {
      row.demand_alert_score = null;
    } else {
      const num = Number(n);
      if (!Number.isFinite(num)) {
        throw new Error('Порог алерта: некорректное число');
      }
      row.demand_alert_score = num;
    }
  }

  const { error } = await supabaseAdmin
    .from('integration_settings')
    .upsert({ id: 1, ...row }, { onConflict: 'id' });

  if (error) {
    throw new Error(error.message);
  }

  invalidateIntegrationSettingsCache();
  return getIntegrationSettings(true);
}

export function publicIntegrationView(settings: EffectiveIntegrationSettings) {
  const db = settings.db;
  const secretSet = (dbVal: string | null | undefined, envVal: string | undefined) =>
    Boolean(dbVal?.trim() || envVal?.trim());

  return {
    avito: {
      enabled: settings.avito.enabled,
      configured: settings.avito.configured,
      demand_from_messenger: settings.avito.demandFromMessenger,
      client_id: settings.avito.clientId,
      user_id: settings.avito.userId,
      client_secret_set: secretSet(db?.avito_client_secret, process.env.AVITO_CLIENT_SECRET),
      webhook_secret_set: secretSet(db?.avito_webhook_secret, process.env.AVITO_WEBHOOK_SECRET),
      client_id_from_db: Boolean(db?.avito_client_id?.trim()),
      user_id_from_db: Boolean(db?.avito_user_id?.trim()),
      client_secret_from_db: Boolean(db?.avito_client_secret?.trim()),
      webhook_secret_from_db: Boolean(db?.avito_webhook_secret?.trim()),
    },
    gosplan: {
      enabled: settings.gosplan.enabled,
      base_url: settings.gosplan.baseUrl,
      regions: settings.gosplan.regions,
      api_key_set: secretSet(db?.gosplan_api_key, process.env.GOSPLAN_API_KEY),
      api_key_from_db: Boolean(db?.gosplan_api_key?.trim()),
    },
    demand: {
      demo: settings.demand.demo,
      feed_url: settings.demand.feedUrl,
      home_regions: settings.demand.homeRegions,
      min_volume_m3: settings.demand.minVolumeM3,
      alert_score: settings.demand.alertScore,
      feed_url_from_db: Boolean(db?.demand_feed_url?.trim()),
      home_regions_from_db: Boolean(db?.demand_home_regions?.trim()),
    },
    table_ready: Boolean(db),
    updated_at: db?.updated_at ?? null,
  };
}
