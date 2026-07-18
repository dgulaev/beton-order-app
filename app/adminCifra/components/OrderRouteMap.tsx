'use client';
// app/adminCifra/components/OrderRouteMap.tsx
// Вертикальный баннер с интерактивной картой Яндекс: точка завода и точка
// адреса доставки, карта автоматически масштабируется так, чтобы обе точки
// были видны в кадре (ближе — крупнее, дальше — мельче).
//
// ⚠️ Реальный маршрут по дорогам (ymaps.multiRouter.MultiRoute) требует
// отдельного платного продукта в кабинете разработчика Яндекса — «API
// Получения деталей маршрута» (от ~195 000 ₽/год за 1000 запросов/сутки),
// поэтому здесь его нет. Настоящий маршрут по дорогам пользователь получает
// бесплатно по клику — ссылка ведёт на полноценные Яндекс.Карты (или Google
// Карты запасным вариантом), которые сами считают маршрут в своём интерфейсе.
//
// Вся карточка — кликабельная ссылка, открывающая маршрут на отдельной странице.

import React, { useEffect, useRef, useState } from 'react';
import { hasYandexMapsKey, loadYmaps } from '@/lib/yandexMapsLoader';
import { ROUTE_ORIGIN_COORDS, useDeliveryCoords } from '@/lib/yandexRoute';

interface OrderRouteMapProps {
  address: string | null | undefined;
  routeHref: string;
}

export default function OrderRouteMap({ address, routeHref }: OrderRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Статус карты (скрипт загрузился, ymaps.Map создан, точки добавлены).
  const [mapStatus, setMapStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');

  const { coords: destCoords, ready: coordsReady } = useDeliveryCoords(address);

  // Синхронно выводимое состояние — сразу известно из пропсов/хука координат
  // на каждый рендер, без лишнего эффекта.
  const status: 'loading' | 'ready' | 'unavailable' =
    !hasYandexMapsKey() ? 'unavailable' :
    !coordsReady ? 'loading' :
    !destCoords ? 'unavailable' :
    mapStatus === 'pending' ? 'loading' : mapStatus;

  useEffect(() => {
    if (!hasYandexMapsKey() || !coordsReady || !destCoords) return;

    let cancelled = false;

    loadYmaps().then((ymaps) => {
      if (cancelled || !ymaps || !containerRef.current) {
        if (!cancelled) setMapStatus('unavailable');
        return;
      }

      const origin: [number, number] = [ROUTE_ORIGIN_COORDS.lat, ROUTE_ORIGIN_COORDS.lon];
      const destination: [number, number] = [destCoords.lat, destCoords.lon];

      const map = new ymaps.Map(containerRef.current, {
        center: origin,
        zoom: 9,
        controls: [],
      }, {
        suppressMapOpenBlock: true,
      });
      mapRef.current = map;

      // Карта — чисто декоративный превью-баннер, клик по нему обрабатывает
      // ссылка-обёртка снаружи, поэтому собственные жесты карты отключаем.
      map.behaviors.disable(['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch', 'rightMouseButtonMagnifier']);

      const originPlacemark = new ymaps.Placemark(origin, { hintContent: 'Завод' }, {
        preset: 'islands#blueFactoryCircleIcon',
      });
      const destPlacemark = new ymaps.Placemark(destination, { hintContent: 'Адрес доставки' }, {
        preset: 'islands#redDotIcon',
      });

      map.geoObjects.add(originPlacemark);
      map.geoObjects.add(destPlacemark);

      // Автомасштаб под обе точки: если адрес рядом с заводом — карта
      // приближается, чтобы не показывать пустое пространство; если далеко —
      // отдаляется, чтобы обе точки поместились в кадр. Вынесено в функцию,
      // чтобы пересчитывать и при изменении размера контейнера (см. ниже).
      const fitBothPoints = () => {
        map.setBounds(ymaps.util.bounds.fromPoints([origin, destination]), {
          checkZoomRange: true,
          zoomMargin: 40,
          duration: 0,
        });
        // Если точки совпадают/очень близко — setBounds может зазумить почти
        // до предела (дом/подъезд). Для декоративного превью этого слишком
        // близко — не даём приближаться больше "квартала".
        if (map.getZoom() > 15) {
          map.setZoom(15, { checkZoomRange: true });
        }
      };

      fitBothPoints();

      if (!cancelled) setMapStatus('ready');

      // ⚠️ Карта Яндекса при создании фиксирует внутренний размер canvas по
      // размеру контейнера НА ТОТ МОМЕНТ и сама не отслеживает его
      // изменение. Модалка растягивает колонку карты на всю высоту правой
      // колонки (миксеры/история), а та часто досчитывается/дозагружается
      // ПОСЛЕ создания карты — контейнер вырастает, а карта остаётся
      // маленькой, оставляя пустое пространство внизу (особенно заметно на
      // 4K, где модалка выше). fitToViewport() подгоняет canvas под текущий
      // размер контейнера при каждом изменении.
      if (containerRef.current) {
        const resizeObserver = new ResizeObserver(() => {
          if (!mapRef.current) return;
          mapRef.current.container.fitToViewport();
          fitBothPoints();
        });
        resizeObserver.observe(containerRef.current);
        resizeObserverRef.current = resizeObserver;
      }
    });

    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [coordsReady, destCoords, address]);

  if (status === 'unavailable') return null;

  return (
    <a
      href={routeHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Открыть маршрут в Яндекс.Картах"
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        height: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        background: '#25334A',
        flexShrink: 0,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

      {status === 'loading' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748B',
          fontSize: '13px',
        }}>
          Строим карту…
        </div>
      )}

      {status === 'ready' && (
        <div style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          padding: '5px 10px',
          borderRadius: '8px',
          background: 'rgba(15,23,42,0.75)',
          color: '#CBD5E1',
          fontSize: '12px',
          fontWeight: 600,
          pointerEvents: 'none',
        }}>
          Открыть карту ↗
        </div>
      )}
    </a>
  );
}
