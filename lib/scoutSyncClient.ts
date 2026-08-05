import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

export type ScoutSyncClientResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  snapshotsUpdated?: number;
  mapped?: number;
};

/**
 * Ручной sync СКАУТ с сервера. Не считает skipped «успехом»
 * (иначе на проде без SCOUT_* кнопка молча ничего не делает).
 */
export async function requestScoutSync(): Promise<ScoutSyncClientResult> {
  const res = await fetch('/api/adminCifra/integrations/scout/sync', {
    method: 'POST',
    headers: adminCifraAuthHeaders(),
  });
  const json = (await res.json().catch(() => ({}))) as ScoutSyncClientResult & {
    success?: boolean;
    message?: string;
  };

  if (json.skipped || json.reason?.includes('SCOUT_')) {
    return {
      ok: false,
      skipped: true,
      reason: json.reason,
      error:
        json.reason ||
        'СКАУТ не настроен на сервере. Добавьте SCOUT_SERVER_URL, SCOUT_LOGIN, SCOUT_PASSWORD в env (Vercel).',
    };
  }

  if (!res.ok || json.success === false || json.ok === false) {
    return {
      ok: false,
      error: json.error || json.message || json.reason || `Ошибка синхронизации СКАУТ (HTTP ${res.status})`,
      snapshotsUpdated: json.snapshotsUpdated,
      mapped: json.mapped,
    };
  }

  return {
    ok: true,
    snapshotsUpdated: json.snapshotsUpdated,
    mapped: json.mapped,
  };
}
