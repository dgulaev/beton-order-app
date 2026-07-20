'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type MobileNotification = {
  id: number;
  created_at: string;
  type: 'new_order' | 'field_change';
  title: string;
  body: string | null;
  entity_id: number | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  dismissed_at: string | null;
};

export function useMobileNotifications() {
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [animateBell, setAnimateBell] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/mobile/notifications');
      const json = await res.json();
      if (json.success) setNotifications(json.data);
    } catch (e) {
      console.error('[Notifications] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Realtime: новые INSERT-записи появляются сразу без перезагрузки страницы
    const channel = supabase
      .channel('mobile_notifications_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mobile_notifications' },
        (payload) => {
          const newNotif = payload.new as MobileNotification;
          setNotifications((prev) => [newNotif, ...prev]);
          // Анимация колокольчика при новом уведомлении
          setAnimateBell(true);
          setTimeout(() => setAnimateBell(false), 1000);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchNotifications]);

  const dismiss = useCallback(async (id: number) => {
    // Оптимистично убираем из списка
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await fetch(`/api/mobile/notifications/${id}`, { method: 'PATCH' });
    } catch (e) {
      console.error('[Notifications] dismiss error', e);
      // При ошибке восстанавливаем — перечитаем с сервера
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const dismissAll = useCallback(async () => {
    setNotifications([]);
    try {
      await fetch('/api/mobile/notifications', { method: 'DELETE' });
    } catch (e) {
      console.error('[Notifications] dismissAll error', e);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const unreadCount = notifications.length;

  return { notifications, loading, unreadCount, dismiss, dismissAll, animateBell };
}
