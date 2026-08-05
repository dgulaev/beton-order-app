import type {
  ScoutAuthResponse,
  ScoutConfig,
  ScoutOnlineDataResponse,
  ScoutSubscribeResponse,
  ScoutUnit,
  ScoutUnitsResponse,
} from './types';
import { parseScoutDate } from './parseDate';

function baseUrl(config: ScoutConfig): string {
  return config.serverUrl.replace(/\/+$/, '');
}

async function scoutPost<T>(
  config: ScoutConfig,
  path: string,
  body: unknown,
  sessionId?: string,
): Promise<T> {
  const url = `${baseUrl(config)}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers.ScoutAuthorization = sessionId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`СКАУТ ${path}: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }

  return res.json() as Promise<T>;
}

export function getScoutConfigFromEnv(): ScoutConfig | null {
  const serverUrl = process.env.SCOUT_SERVER_URL?.trim();
  const login = process.env.SCOUT_LOGIN?.trim();
  const password = process.env.SCOUT_PASSWORD?.trim();
  if (!serverUrl || !login || !password) return null;
  return { serverUrl, login, password };
}

export function isScoutConfigured(): boolean {
  return getScoutConfigFromEnv() != null;
}

type CachedSession = {
  id: string;
  /** epoch ms — обновляем за минуту до истечения */
  expiresAt: number;
  loginKey: string;
};

let cachedSession: CachedSession | null = null;

function sessionLoginKey(config: ScoutConfig): string {
  return `${config.serverUrl}|${config.login}`;
}

/** Сброс кеша (после 401 / смены env). */
export function clearScoutSessionCache(): void {
  cachedSession = null;
}

export async function scoutLogin(config: ScoutConfig): Promise<string> {
  const data = await scoutPost<ScoutAuthResponse>(config, '/spic/auth/rest/Login', {
    Login: config.login,
    Password: config.password,
    TimeZoneOlsonId: 'Europe/Moscow',
    CultureName: 'ru-ru',
    UiCultureName: 'ru-ru',
  });
  if (!data.IsAuthenticated || !data.SessionId) {
    throw new Error('СКАУТ: авторизация не прошла');
  }

  const expireIso = parseScoutDate(data.ExpireDate) || null;
  const expiresAt = expireIso
    ? new Date(expireIso).getTime()
    : Date.now() + 25 * 60_000; // fallback ~25 мин

  cachedSession = {
    id: data.SessionId,
    expiresAt,
    loginKey: sessionLoginKey(config),
  };
  return data.SessionId;
}

/** Login с reuse SessionId до ExpireDate (минус 60 с). */
export async function scoutGetSession(config: ScoutConfig): Promise<string> {
  const key = sessionLoginKey(config);
  if (
    cachedSession &&
    cachedSession.loginKey === key &&
    cachedSession.expiresAt > Date.now() + 60_000
  ) {
    return cachedSession.id;
  }
  return scoutLogin(config);
}

const UNITS_PAGE = 500;
const UNITS_MAX = 10_000;

export async function scoutGetAllUnits(
  config: ScoutConfig,
  sessionId: string,
): Promise<ScoutUnitsResponse> {
  const all: ScoutUnit[] = [];
  let offset = 0;
  let lastState: ScoutUnitsResponse['State'];

  for (;;) {
    const page = await scoutPost<ScoutUnitsResponse>(
      config,
      '/spic/units/rest/getAllUnitsPaged',
      { Offset: offset, Count: UNITS_PAGE },
      sessionId,
    );
    lastState = page.State;
    const batch = page.Units ?? [];
    all.push(...batch);
    if (batch.length < UNITS_PAGE) break;
    offset += UNITS_PAGE;
    if (offset >= UNITS_MAX) break;
  }

  return { Units: all, State: lastState };
}

export async function scoutGetOnlineData(
  config: ScoutConfig,
  sessionId: string,
  unitIds: number[],
): Promise<ScoutOnlineDataResponse> {
  const sub = await scoutPost<ScoutSubscribeResponse>(
    config,
    '/spic/OnlineDataService/rest/Subscribe',
    { UnitIds: unitIds },
    sessionId,
  );
  const subId = sub.SessionId?.Id;
  if (!subId) {
    const codes = sub.State?.ErrorCodes?.join(', ') ?? '?';
    throw new Error(`СКАУТ Subscribe failed (codes: ${codes})`);
  }
  return scoutPost<ScoutOnlineDataResponse>(
    config,
    '/spic/OnlineDataService/rest/GetOnlineData',
    { Id: subId },
    sessionId,
  );
}

export { parseScoutDate } from './parseDate';
