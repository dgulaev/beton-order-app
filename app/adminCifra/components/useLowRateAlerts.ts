'use client';

import { useEffect } from 'react';
import type { LowRateAlertInfo } from '@/lib/siloConfig';
import { appAlert } from './appDialog';

/** Глобальный замок: оператор и склад не покажут один эпизод дважды. */
let globalLowRateBusy = false;
const globalShownEpisodes = new Set<string>();

function episodeKey(a: LowRateAlertInfo): string {
  return `${a.siloId}:${a.alertAt || 'pending'}`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

function formatAlertMessage(alerts: LowRateAlertInfo[]): string {
  const lines = alerts.map((a) => {
    const cur = a.currentTons.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    const thr = a.thresholdTons.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    return `• ${a.siloName}: ${cur} т (порог −${thr} т)`;
  });
  return (
    'Расход слишком низкий — проверьте завод!\n\n'
    + 'Остаток силоса ушёл глубоко в минус относительно рецептов:\n'
    + lines.join('\n')
  );
}

/**
 * Показывает pending-алерты глубокого минуса и сразу помечает их ack в БД,
 * чтобы после обновления страницы они не всплывали снова.
 */
export function useLowRateAlerts(alerts: LowRateAlertInfo[] | undefined | null) {
  useEffect(() => {
    const pending = (alerts || []).filter(
      (a) => a.pending && !globalShownEpisodes.has(episodeKey(a)),
    );
    if (pending.length === 0 || globalLowRateBusy) return;

    globalLowRateBusy = true;

    (async () => {
      try {
        const res = await fetch('/api/adminCifra/warehouse/low-rate-alert', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ siloIds: pending.map((a) => a.siloId) }),
        });
        if (!res.ok) {
          // Без успешного ack при F5 алерт может повториться — не спамим каждые 15с
          console.error('low-rate ack failed:', res.status, await res.text().catch(() => ''));
        }
        for (const a of pending) globalShownEpisodes.add(episodeKey(a));
        await appAlert(formatAlertMessage(pending), {
          title: 'Проверьте завод',
          variant: 'warning',
          okLabel: 'Понятно',
        });
      } catch (err) {
        console.error('low-rate alert UI:', err);
      } finally {
        globalLowRateBusy = false;
      }
    })();
  }, [alerts]);
}
