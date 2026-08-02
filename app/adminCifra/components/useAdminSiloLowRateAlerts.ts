'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SILO_LOW_RATE_ADMIN_TYPE } from '@/lib/siloLowRateAdminNotif';
import { appAlert } from './appDialog';

type AdminNotif = {
  id: number;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  is_read?: boolean | null;
  user_id?: number | null;
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

function formatMessage(list: AdminNotif[]): string {
  const bodies = list.map((n) => {
    const title = String(n.title || 'Силос: глубокий минус');
    const raw = String(n.message || '')
      .replace(/\n?\[episode:[^\]]+\]/g, '')
      .trim();
    return `• ${title}${raw ? `\n  ${raw}` : ''}`;
  });
  return (
    'Нужно дать задание оператору проверить оборудование.\n\n'
    + bodies.join('\n\n')
  );
}

/**
 * Персистентный one-shot алерт админу по глубокому минусу силоса.
 * Тянет непрочитанные из БД при входе + realtime INSERT; после «Понятно» —
 * is_read=true, по этому эпизоду больше не показываем.
 */
export function useAdminSiloLowRateAlerts(enabled: boolean) {
  const busyRef = useRef(false);
  const shownIdsRef = useRef<Set<number>>(new Set());
  const queueRef = useRef<AdminNotif[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

    const flush = async () => {
      if (busyRef.current || cancelled) return;
      const pending = queueRef.current.filter(
        (n) => !shownIdsRef.current.has(Number(n.id)),
      );
      if (pending.length === 0) return;

      busyRef.current = true;
      queueRef.current = [];
      try {
        for (const n of pending) shownIdsRef.current.add(Number(n.id));
        await appAlert(formatMessage(pending), {
          title: 'Проверьте силос — задание оператору',
          variant: 'warning',
          okLabel: 'Понятно',
        });
        const res = await fetch('/api/adminCifra/notifications', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ ids: pending.map((n) => n.id) }),
        });
        if (!res.ok) {
          console.error(
            'admin silo-low-rate ack failed:',
            res.status,
            await res.text().catch(() => ''),
          );
        }
      } catch (err) {
        console.error('admin silo-low-rate UI:', err);
        for (const n of pending) shownIdsRef.current.delete(Number(n.id));
        queueRef.current.push(...pending);
      } finally {
        busyRef.current = false;
        if (queueRef.current.length > 0) void flush();
      }
    };

    const enqueue = (rows: AdminNotif[]) => {
      const fresh = rows.filter(
        (n) =>
          String(n.type) === SILO_LOW_RATE_ADMIN_TYPE
          && !n.is_read
          && Number(n.id) > 0
          && !shownIdsRef.current.has(Number(n.id)),
      );
      if (fresh.length === 0) return;
      const seen = new Set(queueRef.current.map((x) => Number(x.id)));
      for (const n of fresh) {
        if (!seen.has(Number(n.id))) queueRef.current.push(n);
      }
      void flush();
    };

    const loadUnread = async () => {
      try {
        const qs = new URLSearchParams({
          type: SILO_LOW_RATE_ADMIN_TYPE,
          unread: 'true',
          mine: 'true',
        });
        const res = await fetch(`/api/adminCifra/notifications?${qs}`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        enqueue(Array.isArray(data.notifications) ? data.notifications : []);
      } catch (err) {
        console.error('admin silo-low-rate load:', err);
      }
    };

    void loadUnread();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const sb = url && key ? createClient(url, key) : null;
    if (sb) {
      const userId = Number(localStorage.getItem('userId') || 0);
      channel = sb
        .channel(`admin-silo-low-rate:${userId || 'x'}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'admin_notifications',
            filter: userId > 0 ? `user_id=eq.${userId}` : undefined,
          },
          (payload) => {
            const row = payload.new as AdminNotif;
            if (cancelled) return;
            enqueue([row]);
          },
        )
        .subscribe();
    }

    // Подтянуть при возврате на вкладку (офлайн → онлайн)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadUnread();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sb && channel) sb.removeChannel(channel);
    };
  }, [enabled]);
}
