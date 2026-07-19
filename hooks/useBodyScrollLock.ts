'use client';

import { useEffect } from 'react';

/**
 * Блокирует скролл фоновой страницы, пока открыта модалка (fullscreen-оверлей
 * поверх контента). Обычный `overflow: hidden` на body iOS Safari игнорирует
 * при жестах — поэтому дополнительно фиксируем position/width. Паттерн взят
 * из app/mobile/driver/components/DriverTripDetailModal.tsx, где он уже
 * проверен на реальных телефонах.
 *
 * @param active — блокировать скролл сейчас (по умолчанию true). Передавайте
 * `isOpen`, если компонент модалки всегда смонтирован и переключается через проп.
 */
export function useBodyScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return;

    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevWidth = document.body.style.width;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = prevWidth;
    };
  }, [active]);
}
