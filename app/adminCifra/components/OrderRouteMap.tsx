'use client';
// app/adminCifra/components/OrderRouteMap.tsx
// Вертикальный баннер с интерактивной картой: точка завода и точка адреса
// доставки, линия маршрута по дорогам (см. lib/routeGeometry.ts), карта
// автоматически масштабируется так, чтобы всё было видно в кадре. Карта
// полноценно интерактивна (зум колесом/пинчем, перетаскивание) и умеет
// переключать вид (схема/спутник/светлая/тёмная/топографическая).
//
// Самовывоз: только точка завода, без маршрута «в центр города».

import React, { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Polyline, Control } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink } from 'lucide-react';
import {
  getRouteOriginCoords,
  useDeliveryCoords,
  getShortDeliveryLabel,
  isPickupOrder,
} from '@/lib/yandexRoute';
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
  const boundsPointsRef = useRef<[number, number][]>([]);
  const fitBothPointsRef = useRef<() => void>(() => {});
  const [mapStatus, setMapStatus] = useState<'pending' | 'ready' | 'unavailable'>('pending');

  const pickup = isPickupOrder(address);
  const { coords: destCoords, ready: coordsReady } = useDeliveryCoords(address);
  // Для самовывоза маршрут по дорогам не нужен — только точка завода.
  const routeGeometry = useRouteGeometry(pickup ? null : destCoords);

  const status: 'loading' | 'ready' | 'unavailable' =
    !coordsReady ? 'loading' :
    !destCoords ? 'unavailable' :
    mapStatus === 'pending' ? 'loading' : mapStatus;

  useEffect(() => {
    if (!coordsReady || !destCoords || !containerRef.current) return;

    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      const o = getRouteOriginCoords();
      const origin: [number, number] = [o.lat, o.lon];
      const destination: [number, number] = [destCoords.lat, destCoords.lon];
      const samePoint =
        pickup
        || (Math.abs(origin[0] - destination[0]) < 1e-5
          && Math.abs(origin[1] - destination[1]) < 1e-5);

      const map = L.map(containerRef.current, {
        center: origin,
        zoom: samePoint ? 14 : 9,
        zoomControl: true,
        attributionControl: true,
      });
      // Убираем префикс «🇺🇦 Leaflet |» — оставляем только © OpenStreetMap (и др. слоёв).
      map.attributionControl?.setPrefix(false);
      mapRef.current = map;

      const baseLayers = makeBaseLayers(L);
      baseLayers['Схема'].addTo(map);
      layersControlRef.current = L.control.layers(baseLayers, undefined, { position: 'topright' }).addTo(map);

      L.marker(origin, { icon: makeDivIcon(L, '#2563EB') })
        .addTo(map)
        .bindTooltip(pickup ? 'Завод · самовывоз' : 'Завод');

      if (!samePoint) {
        L.marker(destination, { icon: makeDivIcon(L, '#DC2626') })
          .addTo(map)
          .bindTooltip(getShortDeliveryLabel(address));
      }

      const fitBothPoints = () => {
        map.fitBounds(boundsPointsRef.current, { padding: [32, 32], animate: false });
        if (map.getZoom() > 15) {
          map.setZoom(15, { animate: false });
        }
      };
      fitBothPointsRef.current = fitBothPoints;

      boundsPointsRef.current = samePoint ? [origin] : [origin, destination];
      if (samePoint) {
        map.setView(origin, 14, { animate: false });
      } else {
        fitBothPoints();
      }

      if (!cancelled) setMapStatus('ready');

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
  }, [coordsReady, destCoords, address, pickup]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== 'ready' || pickup) return;

    import('leaflet').then((L) => {
      if (mapRef.current !== map) return;

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
  }, [routeGeometry, mapStatus, pickup]);

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

      {status === 'ready' && pickup && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 1000,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.88)',
            border: '1px solid rgba(96,165,250,0.45)',
            color: '#93C5FD',
            fontSize: 12,
            fontWeight: 700,
            pointerEvents: 'none',
          }}
        >
          Самовывоз · завод
        </div>
      )}

      {status === 'ready' && (
        <a
          href={routeHref}
          target="_blank"
          rel="noopener noreferrer"
          title={pickup ? 'Открыть завод на карте' : 'Открыть маршрут в приложении карт'}
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
          {pickup ? 'Завод на карте' : 'Открыть маршрут'} <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
