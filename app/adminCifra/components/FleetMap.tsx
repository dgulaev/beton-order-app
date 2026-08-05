'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink } from 'lucide-react';

/** Тип ТС для иконки на карте (как VehicleKind, без лишней зависимости UI→каталог). */
export type FleetMapVehicleKind =
  | 'mixer'
  | 'dump_truck'
  | 'tonar'
  | 'cement_truck'
  | 'tractor_unit'
  | 'special';

export type FleetMapMarker = {
  id: number | string;
  lat: number;
  lon: number;
  label: string;
  subtitle?: string;
  isOnline?: boolean;
  speedKmh?: number | null;
  address?: string | null;
  lastMessageAt?: string | null;
  /** vehicle — ТС; plant/destination — круги на карте маршрутов */
  kind?: 'vehicle' | 'plant' | 'destination';
  /** Вид техники: mixer → mixer-truck.png, dump_truck → samosval.png */
  vehicleKind?: FleetMapVehicleKind | string | null;
  color?: string;
};

export type FleetMapPathPoint = {
  lat: number;
  lon: number;
};

export type FleetMapRoute = {
  id: number | string;
  points: FleetMapPathPoint[];
  color?: string;
  label?: string;
  /** Приглушить, если выбран другой маршрут */
  dimmed?: boolean;
  /** Пунктир (факт GPS / сравнение с планом) */
  dashed?: boolean;
  weight?: number;
};

type PlacedMarker = FleetMapMarker & {
  displayLat: number;
  displayLon: number;
  clusterSize: number;
};

interface FleetMapProps {
  markers: FleetMapMarker[];
  /** Одна полилиния (совместимость) */
  path?: FleetMapPathPoint[];
  pathColor?: string;
  /** Несколько маршрутов (рейсы) */
  routes?: FleetMapRoute[];
  highlightId?: number | string | null;
  /** Tooltip машин по hover. В карточке ТС обычно false — данные уже под картой. */
  markerTooltips?: boolean;
  height?: number | string;
  externalHref?: string | null;
  externalLabel?: string;
  emptyMessage?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MIXER_TRUCK_ICON = '/icons/mixer-truck.png';
const DUMP_TRUCK_ICON = '/icons/samosval.png';

/** Иконка по виду ТС — самосвалы готовы, остальные пока миксер. */
export function fleetMapVehicleIconSrc(
  vehicleKind?: FleetMapVehicleKind | string | null,
): string {
  if (vehicleKind === 'dump_truck') return DUMP_TRUCK_ICON;
  return MIXER_TRUCK_ICON;
}

function markerStatusStyle(isOnline?: boolean, highlighted?: boolean): {
  imgFilter: string;
  badgeBg: string;
  badgeText: string;
} {
  if (highlighted) {
    return {
      imgFilter: 'saturate(1.25) brightness(1.06) hue-rotate(-12deg)',
      badgeBg: '#2563EB',
      badgeText: 'выбрана',
    };
  }
  if (isOnline) {
    return {
      imgFilter: 'none',
      badgeBg: '#16A34A',
      badgeText: 'online',
    };
  }
  // Offline: без сильного grayscale — иначе миксер почти невидим на светлой схеме
  return {
    imgFilter: 'grayscale(0.35) brightness(0.92) saturate(0.7)',
    badgeBg: '#64748B',
    badgeText: 'offline',
  };
}

function makePointIcon(
  L: typeof import('leaflet'),
  marker: FleetMapMarker,
) {
  const kind = marker.kind || 'vehicle';
  const color =
    marker.color ||
    (kind === 'plant' ? '#22C55E' : kind === 'destination' ? '#38BDF8' : '#64748B');
  const label = escapeHtml(marker.label || '');
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 6px rgba(15,23,42,0.45))">
      <div style="width:14px;height:14px;border-radius:9999px;background:${color};border:2px solid #fff"></div>
      <div style="margin-top:3px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:4px;background:rgba(15,23,42,0.85);color:#F8FAFC;font:700 10px/14px system-ui,-apple-system,sans-serif">${label}</div>
    </div>
  `;
  return L.divIcon({
    className: 'fleet-map-vehicle-icon',
    html,
    iconSize: [104, 36],
    iconAnchor: [52, 8],
    tooltipAnchor: [0, -10],
  });
}

function makeVehicleIcon(
  L: typeof import('leaflet'),
  marker: FleetMapMarker,
  highlighted?: boolean,
) {
  if (marker.kind === 'plant' || marker.kind === 'destination') {
    return makePointIcon(L, marker);
  }
  const status = markerStatusStyle(marker.isOnline, highlighted);
  const size = highlighted ? 56 : 48;
  const badgeH = 16;
  const plate = escapeHtml(marker.label || '');
  const totalH = size + badgeH + 14;
  const iconSrc = fleetMapVehicleIconSrc(marker.vehicleKind);

  const html = `
    <div style="
      width:${Math.max(size + 8, 72)}px;
      height:${totalH}px;
      display:flex;
      flex-direction:column;
      align-items:center;
      filter:
        drop-shadow(0 0 0 2px rgba(255,255,255,0.95))
        drop-shadow(0 3px 8px rgba(15,23,42,0.5));
    ">
      <img
        src="${iconSrc}"
        width="${size}"
        height="${size}"
        draggable="false"
        alt=""
        style="object-fit:contain;display:block;filter:${status.imgFilter};"
      />
      <div style="
        margin-top:-2px;
        padding:1px 6px;
        border-radius:9999px;
        background:${status.badgeBg};
        color:#fff;
        font:700 9px/14px system-ui,-apple-system,sans-serif;
        letter-spacing:0.02em;
        white-space:nowrap;
        box-shadow:0 1px 3px rgba(15,23,42,0.35);
      ">${status.badgeText}</div>
      <div style="
        margin-top:2px;
        max-width:88px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        padding:0 4px;
        border-radius:4px;
        background:rgba(15,23,42,0.82);
        color:#F8FAFC;
        font:700 10px/14px system-ui,-apple-system,sans-serif;
      ">${plate}</div>
    </div>
  `;

  return L.divIcon({
    className: 'fleet-map-vehicle-icon',
    html,
    iconSize: [Math.max(size + 8, 72), totalH],
    iconAnchor: [Math.max(size + 8, 72) / 2, size / 2],
    tooltipAnchor: [0, -(size / 2 + 10)],
  });
}

/** Группируем точки ближе ~40 м — иначе два миксера на стоянке выглядят как один */
function nearbyGroupKey(lat: number, lon: number): string {
  const cell = 0.0004; // ≈ 40–45 м
  const latCell = Math.round(lat / cell);
  const lonCell = Math.round(lon / cell);
  return `${latCell}:${lonCell}`;
}

function spreadOverlappingMarkers(markers: FleetMapMarker[]): {
  placed: PlacedMarker[];
  clusters: Array<{ lat: number; lon: number; count: number }>;
} {
  const groups = new Map<string, FleetMapMarker[]>();

  for (const marker of markers) {
    const key = nearbyGroupKey(Number(marker.lat), Number(marker.lon));
    const list = groups.get(key) ?? [];
    list.push(marker);
    groups.set(key, list);
  }

  const placed: PlacedMarker[] = [];
  const clusters: Array<{ lat: number; lon: number; count: number }> = [];

  for (const group of groups.values()) {
    const baseLat = group[0].lat;
    const baseLon = group[0].lon;
    const count = group.length;

    if (count > 1) {
      clusters.push({ lat: baseLat, lon: baseLon, count });
    }

    if (count === 1) {
      placed.push({
        ...group[0],
        displayLat: baseLat,
        displayLon: baseLon,
        clusterSize: 1,
      });
      continue;
    }

    const baseRadius = 0.00035; // ~35–40 м — чтобы миксеры на стоянке не сливались
    const radius = baseRadius * (1 + Math.min(count - 2, 6) * 0.18);
    const cosLat = Math.max(0.2, Math.cos((baseLat * Math.PI) / 180));

    group.forEach((marker, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      placed.push({
        ...marker,
        displayLat: baseLat + radius * Math.sin(angle),
        displayLon: baseLon + (radius * Math.cos(angle)) / cosLat,
        clusterSize: count,
      });
    });
  }

  return { placed, clusters };
}

function formatLastMessage(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tooltipHtml(marker: PlacedMarker): string {
  const statusColor = marker.isOnline ? '#4ADE80' : '#94A3B8';
  const statusLabel = marker.isOnline ? 'На связи' : 'Offline';
  const lastMessage = formatLastMessage(marker.lastMessageAt);
  const positionHint = marker.isOnline ? null : 'Последняя известная точка';

  return `
    <div style="min-width:180px;max-width:260px;line-height:1.45">
      <div style="font-weight:700;font-size:14px;color:#F8FAFC;margin-bottom:2px">${escapeHtml(marker.label)}</div>
      ${
        marker.subtitle
          ? `<div style="color:#94A3B8;font-size:12px;margin-bottom:8px">${escapeHtml(marker.subtitle)}</div>`
          : ''
      }
      <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;margin-bottom:${marker.address || lastMessage || positionHint ? '8px' : '0'}">
        <span style="color:${statusColor};font-weight:700">${statusLabel}</span>
        ${
          marker.isOnline && marker.speedKmh != null
            ? `<span style="color:#CBD5E1">${Math.round(marker.speedKmh)} км/ч</span>`
            : ''
        }
      </div>
      ${
        positionHint
          ? `<div style="font-size:11px;color:#FBBF24;margin-bottom:4px">${positionHint}</div>`
          : ''
      }
      ${
        marker.address
          ? `<div style="font-size:11px;color:#94A3B8;margin-bottom:4px">${escapeHtml(marker.address)}</div>`
          : ''
      }
      ${
        lastMessage
          ? `<div style="font-size:11px;color:#64748B">Сигнал: ${escapeHtml(lastMessage)}</div>`
          : ''
      }
      ${
        marker.clusterSize > 1
          ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #334155;font-size:11px;color:#FBBF24">В этой точке GPS: ${marker.clusterSize} маш.</div>`
          : ''
      }
    </div>
  `;
}

function makeBaseLayers(L: typeof import('leaflet')) {
  const osmAttr =
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
  return {
    Схема: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      attribution: osmAttr,
    }),
    'Тёмная': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: `${osmAttr} © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`,
    }),
    Спутник: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles © <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer">Esri</a>',
      },
    ),
  };
}

function normalizeRoutes(
  routes: FleetMapRoute[] | undefined,
  path: FleetMapPathPoint[] | undefined,
  pathColor: string,
): FleetMapRoute[] {
  if (routes?.length) {
    return routes
      .map((r) => ({
        ...r,
        points: (r.points || [])
          .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0)),
      }))
      .filter((r) => r.points.length >= 2);
  }
  const single = (path || [])
    .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0));
  if (single.length < 2) return [];
  return [{ id: 'path', points: single, color: pathColor }];
}

export default function FleetMap({
  markers,
  path = [],
  pathColor = '#38BDF8',
  routes,
  highlightId = null,
  markerTooltips = true,
  height = 220,
  externalHref = null,
  externalLabel = 'Открыть на карте',
  emptyMessage = 'Нет координат для отображения',
}: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRefs = useRef<Map<number | string, LeafletMarker>>(new Map());
  const clusterLayerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const pathLayerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const pathEndsRef = useRef<import('leaflet').LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [mapStatus, setMapStatus] = useState<'pending' | 'ready'>('pending');

  const validMarkers = markers
    .map((m) => ({ ...m, lat: Number(m.lat), lon: Number(m.lon) }))
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && !(m.lat === 0 && m.lon === 0));
  const validRoutes = normalizeRoutes(routes, path, pathColor);
  const validMarkersRef = useRef(validMarkers);
  validMarkersRef.current = validMarkers;
  const validRoutesRef = useRef(validRoutes);
  validRoutesRef.current = validRoutes;
  const hasContent = validMarkers.length > 0 || validRoutes.length > 0;
  /** Remount карты только при смене набора машин / маршрутов */
  const idsKey = validMarkers
    .map((m) => String(m.id))
    .sort()
    .join('|');
  const pathKey = validRoutes
    .map((r) => {
      const pts = r.points;
      const mid = pts[Math.floor(pts.length / 2)];
      const q1 = pts[Math.floor(pts.length / 4)];
      const q3 = pts[Math.floor((pts.length * 3) / 4)];
      return [
        r.id,
        r.color,
        r.dimmed ? 1 : 0,
        r.dashed ? 1 : 0,
        pts.length,
        pts[0]?.lat,
        pts[0]?.lon,
        q1?.lat,
        mid?.lon,
        q3?.lat,
        pts[pts.length - 1]?.lat,
        pts[pts.length - 1]?.lon,
      ].join(':');
    })
    .join('|');
  const markersKey = validMarkers
    .map(
      (m) =>
        `${m.id}:${m.lat}:${m.lon}:${m.isOnline}:${m.label}:${m.address ?? ''}:${m.vehicleKind ?? ''}`,
    )
    .join('|');

  useEffect(() => {
    if (!containerRef.current || !hasContent) {
      setMapStatus('pending');
      return;
    }

    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;

      const { placed } = spreadOverlappingMarkers(validMarkersRef.current);
      const routeList = validRoutesRef.current;
      const firstRoutePt = routeList[0]?.points[0];
      const centerLat = placed[0]?.displayLat ?? firstRoutePt?.lat ?? 53.25;
      const centerLon = placed[0]?.displayLon ?? firstRoutePt?.lon ?? 34.37;

      const map = L.map(containerRef.current, {
        center: [centerLat, centerLon],
        zoom: 14,
        zoomControl: true,
        attributionControl: true,
      });
      mapRef.current = map;

      const baseLayers = makeBaseLayers(L);
      baseLayers['Схема'].addTo(map);
      L.control.layers(baseLayers, undefined, { position: 'topright' }).addTo(map);

      clusterLayerRef.current = L.layerGroup().addTo(map);
      pathLayerRef.current = L.layerGroup().addTo(map);
      pathEndsRef.current = L.layerGroup().addTo(map);

      const fitPts: [number, number][] = [];

      // Одна точка старта (завод), если несколько рейсов
      if (routeList.length > 0) {
        const first = routeList[0]!.points[0]!;
        L.circleMarker([first.lat, first.lon], {
          radius: 7,
          color: '#22C55E',
          fillColor: '#22C55E',
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip('Завод (Орловский тупик)', {
            className: 'fleet-map-tooltip-wrap',
          })
          .addTo(pathEndsRef.current!);
      }

      for (const route of routeList) {
        const latlngs = route.points.map((p) => [p.lat, p.lon] as [number, number]);
        latlngs.forEach((p) => fitPts.push(p));
        const color = route.color || pathColor;
        const dimmed = Boolean(route.dimmed);
        L.polyline(latlngs, {
          color,
          weight: dimmed ? 3 : route.weight ?? (route.dashed ? 4 : 5),
          opacity: dimmed ? 0.22 : route.dashed ? 0.85 : 0.92,
          lineJoin: 'round',
          dashArray: route.dashed ? '10 8' : undefined,
        }).addTo(pathLayerRef.current!);

        // Конец только у плановых (не пунктирных) линий — иначе дубли
        if (!route.dashed && (!dimmed || routeList.filter((r) => !r.dashed).length === 1)) {
          L.circleMarker(latlngs[latlngs.length - 1], {
            radius: 6,
            color: color,
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          })
            .bindTooltip(route.label ? `Объект · ${route.label}` : 'Объект', {
              className: 'fleet-map-tooltip-wrap',
            })
            .addTo(pathEndsRef.current!);
        }
      }

      markerRefs.current.clear();

      for (const marker of placed) {
        const highlighted = highlightId != null && String(marker.id) === String(highlightId);
        const point: [number, number] = [marker.displayLat, marker.displayLon];
        fitPts.push(point);

        const mapMarker = L.marker(point, {
          icon: makeVehicleIcon(L, marker, highlighted),
        }).addTo(map);

        // Не openTooltip() при highlight — иначе подсказка всегда поверх карты
        if (markerTooltips) {
          mapMarker.bindTooltip(tooltipHtml(marker), {
            direction: 'top',
            opacity: 1,
            sticky: true,
            className: 'fleet-map-tooltip-wrap',
          });
        }
        markerRefs.current.set(marker.id, mapMarker);
      }

      if (fitPts.length === 1) {
        map.setView(fitPts[0], 15, { animate: false });
      } else if (fitPts.length > 1) {
        map.fitBounds(fitPts, { padding: [48, 48], animate: false });
        if (map.getZoom() > 16) map.setZoom(16, { animate: false });
      }

      if (!cancelled) setMapStatus('ready');

      const resizeObserver = new ResizeObserver(() => {
        mapRef.current?.invalidateSize();
      });
      resizeObserver.observe(containerRef.current);
      resizeObserverRef.current = resizeObserver;
    });

    return () => {
      cancelled = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      markerRefs.current.clear();
      clusterLayerRef.current = null;
      pathLayerRef.current = null;
      pathEndsRef.current = null;
      leafletRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapStatus('pending');
    };
  }, [idsKey, pathKey, highlightId, pathColor, hasContent, markerTooltips]);

  // Live-обновление координат после broadcast (без пересоздания карты)
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const current = validMarkersRef.current;
    if (!map || !L || mapStatus !== 'ready' || current.length === 0) return;

    const { placed, clusters } = spreadOverlappingMarkers(current);
    const alive = new Set(placed.map((m) => m.id));

    for (const [id, marker] of markerRefs.current) {
      if (!alive.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
      }
    }

    clusterLayerRef.current?.clearLayers();
    for (const cluster of clusters) {
      L.circleMarker([cluster.lat, cluster.lon], {
        radius: 7,
        color: '#64748B',
        weight: 2,
        opacity: 0.85,
        fillColor: '#CBD5E1',
        fillOpacity: 0.55,
      })
        .bindTooltip(`${cluster.count} маш. в одной точке GPS`, {
          direction: 'bottom',
          opacity: 0.95,
          className: 'fleet-map-tooltip-wrap',
        })
        .addTo(clusterLayerRef.current!);
    }

    for (const marker of placed) {
      const highlighted = highlightId != null && String(marker.id) === String(highlightId);
      const point: [number, number] = [marker.displayLat, marker.displayLon];
      const existing = markerRefs.current.get(marker.id);

      if (existing) {
        existing.setLatLng(point);
        existing.setIcon(makeVehicleIcon(L, marker, highlighted));
        if (markerTooltips) {
          if (existing.getTooltip()) {
            existing.setTooltipContent(tooltipHtml(marker));
          } else {
            existing.bindTooltip(tooltipHtml(marker), {
              direction: 'top',
              opacity: 1,
              sticky: true,
              className: 'fleet-map-tooltip-wrap',
            });
          }
        } else if (existing.getTooltip()) {
          existing.unbindTooltip();
        }
      } else {
        const mapMarker = L.marker(point, {
          icon: makeVehicleIcon(L, marker, highlighted),
        }).addTo(map);
        if (markerTooltips) {
          mapMarker.bindTooltip(tooltipHtml(marker), {
            direction: 'top',
            opacity: 1,
            sticky: true,
            className: 'fleet-map-tooltip-wrap',
          });
        }
        markerRefs.current.set(marker.id, mapMarker);
      }
    }
  }, [markersKey, mapStatus, highlightId, markerTooltips]);

  if (!hasContent) {
    return (
      <div
        style={{
          height,
          borderRadius: 12,
          background: '#1E2937',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748B',
          fontSize: 13,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      <style>{`
        .fleet-map-vehicle-icon {
          background: transparent !important;
          border: none !important;
        }
        .fleet-map-tooltip-wrap {
          background: #0F172A !important;
          border: 1px solid #334155 !important;
          border-radius: 12px !important;
          padding: 10px 12px !important;
          color: #E2E8F0 !important;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35) !important;
        }
        .fleet-map-tooltip-wrap:before {
          border-top-color: #334155 !important;
        }
      `}</style>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height,
          borderRadius: 12,
          overflow: 'hidden',
          background: '#E2E8F0',
        }}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

        {mapStatus === 'pending' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748B',
              fontSize: 13,
              pointerEvents: 'none',
              background: 'rgba(226,232,240,0.72)',
            }}
          >
            Загрузка карты…
          </div>
        )}

        {externalHref && mapStatus === 'ready' && (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            title={externalLabel}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 8,
              background: 'rgba(15,23,42,0.85)',
              color: '#CBD5E1',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            }}
          >
            {externalLabel} <ExternalLink size={13} />
          </a>
        )}
      </div>
    </>
  );
}

export function FleetMapLegendIcon({
  online,
  size = 24,
  vehicleKind = 'mixer',
}: {
  online: boolean;
  size?: number;
  vehicleKind?: FleetMapVehicleKind | string | null;
}) {
  const status = markerStatusStyle(online, false);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        marginRight: 8,
        verticalAlign: 'middle',
        filter: 'drop-shadow(0 1px 3px rgba(15,23,42,0.35))',
        flexShrink: 0,
      }}
    >
      <img
        src={fleetMapVehicleIconSrc(vehicleKind)}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain', display: 'block', filter: status.imgFilter }}
      />
    </span>
  );
}
