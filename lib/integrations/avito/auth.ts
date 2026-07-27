import {
  getIntegrationSettings,
  peekIntegrationSettings,
} from '@/lib/integrations/settings';

type TokenCache = {
  accessToken: string;
  expiresAt: number;
  /** Инвалидируем токен при смене client_id/secret */
  fingerprint: string;
};

let cache: TokenCache | null = null;

function credentialsFingerprint(clientId: string, clientSecret: string) {
  return `${clientId}:${clientSecret.slice(0, 4)}:${clientSecret.length}`;
}

/** Sync: кэш настроек или env. Перед важными операциями вызывай getIntegrationSettings(). */
export function isAvitoConfigured(): boolean {
  return peekIntegrationSettings().avito.configured;
}

export function getAvitoUserId(): string | null {
  return peekIntegrationSettings().avito.userId;
}

export async function getAvitoWebhookSecret(): Promise<string | null> {
  const s = await getIntegrationSettings();
  return s.avito.webhookSecret;
}

/** OAuth2 client_credentials → Bearer token (кэш ~23ч). */
export async function getAvitoAccessToken(): Promise<string> {
  const settings = await getIntegrationSettings();
  const clientId = settings.avito.clientId;
  const clientSecret = settings.avito.clientSecret;
  if (!settings.avito.enabled || !clientId || !clientSecret) {
    throw new Error('AVITO_CLIENT_ID / AVITO_CLIENT_SECRET не заданы');
  }

  const fingerprint = credentialsFingerprint(clientId, clientSecret);
  const now = Date.now();
  if (cache && cache.fingerprint === fingerprint && cache.expiresAt > now + 60_000) {
    return cache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://api.avito.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Avito token error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };

  cache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 86400) * 1000,
    fingerprint,
  };

  return cache.accessToken;
}
