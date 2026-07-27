type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let cache: TokenCache | null = null;

export function isAvitoConfigured(): boolean {
  return Boolean(process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET);
}

export function getAvitoUserId(): string | null {
  return process.env.AVITO_USER_ID?.trim() || null;
}

/** OAuth2 client_credentials → Bearer token (кэш ~23ч). */
export async function getAvitoAccessToken(): Promise<string> {
  const clientId = process.env.AVITO_CLIENT_ID;
  const clientSecret = process.env.AVITO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AVITO_CLIENT_ID / AVITO_CLIENT_SECRET не заданы');
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) {
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
  };

  return cache.accessToken;
}
