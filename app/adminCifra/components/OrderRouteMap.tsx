'use client';
// app/adminCifra/components/OrderRouteMap.tsx
// Вертикальный баннер с интерактивной картой: точка завода и точка адреса
// доставки, линия маршрута по дорогам (см. lib/routeGeometry.ts), карта
// автоматически масштабируется так, чтобы всё было видно в кадре. Карта
// полноценно интерактивна (зум колесом/пинчем, перетаскивание) и умеет
// переключать вид (схема/спутник/светлая/тёмная/топографическая).
//
// ⚠️ 18.07.2026: раньше здесь были Яндекс.Карты (JS API), но выяснилось, что
// наша админка — закрытая система для коммерческого использования, а значит
// НЕ подходит под условия бесплатного тарифа Яндекса (он только для открытых
// некоммерческих сайтов). Из-за этого ключ получил урезанный тестовый лимит
// 100 запросов/сутки, которого реальному бизнесу хватает на полчаса работы,
// а при регулярном превышении ключ блокируется навсегда без восстановления.
// Заменили на OpenStreetMap через Leaflet — открытые данные, без API-ключа
// и договорных ограничений.
//
// ⚠️ Раньше вся карточка была одной большой ссылкой (клик в любом месте
// открывал маршрут во внешнем приложении) — карта была чисто декоративной,
// жесты (драг/зум) специально отключались, чтобы не мешать этому клику.
// Теперь карта интерактивна сама по себе, поэтому переход во внешнее
// приложение вынесен в отдельную кнопку в углу (см. `RouteButton` ниже) —
// иначе перетаскивание карты конфликтовало бы с переходом по ссылке.

import React, { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Polyline, Control } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink } from 'lucide-react';
import { ROUTE_ORIGIN_COORDS, useDeliveryCoords, getShortDeliveryLabel } from '@/lib/yandexRoute';
import { useRouteGeometry } from '@/lib/routeGeometry';

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

// Несколько бесплатных подложек без API-ключа — переключаются штатным
// контролом Leaflet (иконка слоёв в углу карты). У каждой — своя атрибуция,
// Leaflet сам показывает её только для активного слоя.
function makeBaseLayers(L: typeof import('leaflet')) {
  const osmAttr = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
  return {
    'Схема': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      attribution: osmAttr,
    }),
    'Светлая': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: `${osmAttr} © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`,
    }),
    'Тёмная': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: `${osmAttr} © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`,
    }),
    'Спутник': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles © <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a>',
    }),
    'Рельеф': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: ['a', 'b', 'c'],
      attribution: `${osmAttr}, SRTM | © <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a>`,
    }),
  };
}

export default function OrderRouteMap({ address, routeHref }: OrderRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const layersControlRef = useRef<Control.Layers | null>(null);
  // Точки, под которые сейчас подогнан автомасштаб — либо просто [завод,
  // адрес], либо (когда подгрузится) вся геометрия маршрута по дорогам —
  // читается и при ресайзе контейнера, и при появлении линии маршрута.
  const boundsPointsRef = useRef<[number, number][]>([]);
  const fitBothPointsRef = useRef<() => void>(() => {});
  // Статус карты (Leaflet создан, точки добавлены).
  const [mapStatus, setMapStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');

  const { coords: destCoords, ready: coordsReady } = useDeliveryCoords(address);
  // Реальный маршрут по дорогам через бесплатный OSRM — необязательное
  // украшение: пока грузится или если не удалось построить, карта работает
  // как раньше (просто две точки), см. `lib/routeGeometry.ts`.
  const routeGeometry = useRouteGeometry(destCoords);

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
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;

      const baseLayers = makeBaseLayers(L);
      baseLayers['Схема'].addTo(map);
      layersControlRef.current = L.control.layers(baseLayers, undefined, { position: 'topright' }).addTo(map);

      L.marker(origin, { icon: makeDivIcon(L, '#2563EB') }).addTo(map).bindTooltip('Завод');
      // Короткая подпись: в Брянске — только улица/дом, в другом населённом
      // пункте области — населённый пункт + улица/дом (см. getShortDeliveryLabel).
      L.marker(destination, { icon: makeDivIcon(L, '#DC2626') }).addTo(map).bindTooltip(getShortDeliveryLabel(address));

      // Автомасштаб под обе точки (или под всю линию маршрута, если она уже
      // подгрузилась — см. эффект с полилинией ниже): если адрес рядом с
      // заводом — карта приближается, чтобы не показывать пустое
      // пространство; если далеко — отдаляется, чтобы всё поместилось в
      // кадр. Вынесено в функцию (и сохранено в ref), чтобы пересчитывать и
      // при изменении размера контейнера, и при появлении линии маршрута.
      // Срабатывает только один раз при построении — дальше карта в руках
      // пользователя (можно свободно зумировать/двигать).
      const fitBothPoints = () => {
        map.fitBounds(boundsPointsRef.current, { padding: [32, 32], animate: false });
        // Если точки совпадают/очень близко — fitBounds может зазумить почти
        // до предела (дом/подъезд). Для превью этого слишком близко — не
        // даём приближаться больше "квартала" при автоподгонке.
        if (map.getZoom() > 15) {
          map.setZoom(15, { animate: false });
        }
      };
      fitBothPointsRef.current = fitBothPoints;

      boundsPointsRef.current = [origin, destination];
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
      });
      resizeObserver.observe(containerRef.current);
      resizeObserverRef.current = resizeObserver;
    });

    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      routeLineRef.current = null;
      layersControlRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [coordsReady, destCoords, address]);

  // Линия маршрута по дорогам — отдельным эффектом, потому что геометрия от
  // OSRM почти всегда подгружается ПОСЛЕ того, как карта с маркерами уже
  // отрисована (второй сетевой запрос, параллельно геокодированию). Как
  // только (и если) она готова — добавляем полилинию и расширяем автомасштаб
  // под всю трассу маршрута, а не только под две конечные точки.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== 'ready') return;

    import('leaflet').then((L) => {
      if (mapRef.current !== map) return; // карта уже сменилась/размонтирована

      routeLineRef.current?.remove();
      routeLineRef.current = null;

      if (routeGeometry && routeGeometry.length > 1) {
        routeLineRef.current = L.polyline(routeGeometry, {
          color: '#3B82F6',
          weight: 4,
          opacity: 0.85,
        }).addTo(map);
        boundsPointsRef.current = routeGeometry;
        fitBothPointsRef.current();
      }
    });
  }, [routeGeometry, mapStatus]);

  if (status === 'unavailable') return null;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        background: '#25334A',
        flexShrink: 0,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {status === 'loading' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748B',
          fontSize: '13px',
          pointerEvents: 'none',
        }}>
          Строим карту…
        </div>
      )}

      {status === 'ready' && (
        <a
          href={routeHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть маршрут в приложении карт"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 12px',
            borderRadius: '8px',
            background: 'rgba(15,23,42,0.85)',
            color: '#CBD5E1',
            fontSize: '12px',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          Открыть маршрут <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
