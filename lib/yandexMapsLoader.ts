'use client';
// lib/yandexMapsLoader.ts
// Однократная загрузка скрипта Яндекс.Карт (JS API 2.1) на всё приложение.
// Несколько компонентов (например, карта в разных модалках заявки) могут
// вызвать loadYmaps() одновременно — здесь гарантируем, что <script> вставится
// в <head> только один раз, а все вызовы получат один и тот же промис.

const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;

declare global {
  interface Window {
    ymaps?: any;
  }
}

let ymapsPromise: Promise<any> | null = null;

/** Синхронная проверка — есть ли смысл вообще пытаться показать карту (ключ настроен). */
export function hasYandexMapsKey(): boolean {
  return !!YANDEX_MAPS_API_KEY;
}

/**
 * Грузит Яндекс.Карты JS API и резолвится готовым объектом `ymaps`
 * (после `ymaps.ready()`). Если ключ не настроен (`NEXT_PUBLIC_YANDEX_MAPS_API_KEY`
 * пуст) — сразу резолвится `null`, ничего не грузит и не показывает ошибок:
 * карта в интерфейсе просто не появится, пока ключ не будет добавлен.
 */
export function loadYmaps(): Promise<any | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!YANDEX_MAPS_API_KEY) return Promise.resolve(null);

  if (ymapsPromise) return ymapsPromise;

  ymapsPromise = new Promise((resolve) => {
    // Скрипт уже загружен раньше (например, StrictMode/повторный маунт) —
    // просто ждём готовности существующего объекта.
    if (window.ymaps) {
      window.ymaps.ready(() => resolve(window.ymaps));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(YANDEX_MAPS_API_KEY)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      if (!window.ymaps) {
        resolve(null);
        return;
      }
      window.ymaps.ready(() => resolve(window.ymaps));
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return ymapsPromise;
}
