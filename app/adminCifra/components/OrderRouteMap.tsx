'use client';
// app/adminCifra/components/OrderRouteMap.tsx
// Вертикальный баннер с интерактивной картой: точка завода и точка адреса
// доставки, карта автоматически масштабируется так, чтобы обе точки были
// видны в кадре (ближе — крупнее, дальше — мельче).
//
// ⚠️ 18.07.2026: раньше здесь были Яндекс.Карты (JS API), но выяснилось, что
// наша админка — закрытая система для коммерческого использования, а значит
// НЕ подходит под условия бесплатного тарифа Яндекса (он только для открытых
// некоммерческих сайтов). Из-за этого ключ получил урезанный тестовый лимит
// 100 запросов/сутки, которого реальному бизнесу хватает на полчаса работы,
// а при регулярном превышении ключ блокируется навсегда без восстановления.
// Заменили на OpenStreetMap через Leaflet — открытые данные, без API-ключа
// и договорных ограничений, что отлично подходит именно для такого
// декоративного превью (реальный маршрут по клику всё равно открывается по
// обычной ссылке в приложении Яндекс/Google/2ГИС — см. `routeHref`, это НЕ
// вызовы API, а обычные переходы по URL, они ничего не тратят).
//
// Вся карточка — кликабельная ссылка, открывающая маршрут на отдельной странице.

import React, { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ROUTE_ORIGIN_COORDS, useDeliveryCoords } from '@/lib/yandexRoute';

interface OrderRouteMapProps {
  address: string | null | undefined;
  routeHref: string;
}

function makeDivIcon(L: typeof import('leaflet'), color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,0.25)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function OrderRouteMap({ address, routeHref }: OrderRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Статус карты (Leaflet создан, точки добавлены).
  const [mapStatus, setMapStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');

  const { coords: destCoords, ready: coordsReady } = useDeliveryCoords(address);

  const status: 'loading' | 'ready' | 'unavailable' =
    !coordsReady ? 'loading' :
    !destCoords ? 'unavailable' :
    mapStatus === 'pending' ? 'loading' : mapStatus;

  useEffect(() => {
    if (!coordsReady || !destCoords || !containerRef.current) return;

    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      const origin: [number, number] = [ROUTE_ORIGIN_COORDS.lat, ROUTE_ORIGIN_COORDS.lon];
      const destination: [number, number] = [destCoords.lat, destCoords.lon];

      const map = L.map(containerRef.current, {
        center: origin,
        zoom: 9,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      mapRef.current = map;

      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addTo(map)
        .setPrefix('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>');

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c'],
      }).addTo(map);

      L.marker(origin, { icon: makeDivIcon(L, '#2563EB'), keyboard: false }).addTo(map).bindTooltip('Завод');
      L.marker(destination, { icon: makeDivIcon(L, '#DC2626'), keyboard: false }).addTo(map).bindTooltip('Адрес доставки');

      // Автомасштаб под обе точки: если адрес рядом с заводом — карта
      // приближается, чтобы не показывать пустое пространство; если далеко —
      // отдаляется, чтобы обе точки поместились в кадр. Вынесено в функцию,
      // чтобы пересчитывать и при изменении размера контейнера (см. ниже).
      const fitBothPoints = () => {
        map.fitBounds([origin, destination], { padding: [32, 32], animate: false });
        // Если точки совпадают/очень близко — fitBounds может зазумить почти
        // до предела (дом/подъезд). Для декоративного превью этого слишком
        // близко — не даём приближаться больше "квартала".
        if (map.getZoom() > 15) {
          map.setZoom(15, { animate: false });
        }
      };

      fitBothPoints();

      if (!cancelled) setMapStatus('ready');

      // ⚠️ Leaflet при создании фиксирует внутренний размер canvas по размеру
      // контейнера НА ТОТ МОМЕНТ и сам не отслеживает его изменение. Модалка
      // растягивает колонку карты на всю высоту правой колонки
      // (миксеры/история), а та часто досчитывается/дозагружается ПОСЛЕ
      // создания карты — контейнер вырастает, а карта остаётся маленькой,
      // оставляя пустое пространство внизу (особенно заметно на 4K, где
      // модалка выше). invalidateSize() подгоняет карту под текущий размер
      // контейнера при каждом изменении.
      const resizeObserver = new ResizeObserver(() => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize();
        fitBothPoints();
      });
      resizeObserver.observe(containerRef.current);
      resizeObserverRef.current = resizeObserver;
    });

    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
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
      title="Открыть маршрут"
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
