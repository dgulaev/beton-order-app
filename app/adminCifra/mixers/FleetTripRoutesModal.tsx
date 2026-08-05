'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import FleetMap, { type FleetMapMarker, type FleetMapRoute } from '../components/FleetMap';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

type TripRouteDto = {
  tripId: number;
  orderId: number;
  color: string;
  label: string;
  clientName: string;
  address: string;
  status: string;
  volume: number;
  pointCount: number;
  approximate: boolean;
  routeSource: 'osrm' | 'gps' | 'straight';
  plannedPoints: { lat: number; lon: number }[];
  actualPoints: { lat: number; lon: number }[];
  points: { lat: number; lon: number }[];
  destination: { lat: number; lon: number } | null;
};

function routeSourceLabel(r: TripRouteDto): string {
  if (r.routeSource === 'osrm') {
    return r.actualPoints?.length >= 2
      ? 'по дорогам + факт GPS'
      : 'по дорогам (OSRM)';
  }
  if (r.routeSource === 'gps') return 'факт GPS';
  return 'схема (прямая)';
}

interface Props {
  open: boolean;
  onClose: () => void;
  mixerId: number;
  mixerNumber: string;
  day: string;
  onDayChange?: (day: string) => void;
  /** Текущая позиция миксера (опционально) */
  liveMarker?: FleetMapMarker | null;
}

export default function FleetTripRoutesModal({
  open,
  onClose,
  mixerId,
  mixerNumber,
  day,
  onDayChange,
  liveMarker = null,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<TripRouteDto[]>([]);
  const [plant, setPlant] = useState<{ lat: number; lon: number; address: string } | null>(null);
  const [gpsSource, setGpsSource] = useState<string>('none');
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!mixerId || !day) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    setRoutes([]);
    setPlant(null);
    setGpsSource('none');
    setSelectedTripId(null);
    try {
      const params = new URLSearchParams({
        mixer_id: String(mixerId),
        day,
      });
      const res = await fetch(`/api/adminCifra/fleet/trip-tracks?${params}`, {
        headers: adminCifraAuthHeaders(),
      });
      const data = await res.json();
      if (seq !== loadSeqRef.current) return;
      if (!res.ok || !data.success) {
        setRoutes([]);
        setPlant(null);
        setSelectedTripId(null);
        setError(data.error || 'Не удалось загрузить маршруты');
        return;
      }
      const nextRoutes: TripRouteDto[] = Array.isArray(data.routes) ? data.routes : [];
      setRoutes(nextRoutes);
      setPlant(data.plant || null);
      setGpsSource(data.gpsSource || 'none');
      // Сразу один рейс — на карте только он, без каши из всех линий
      setSelectedTripId(nextRoutes[0]?.tripId ?? null);
    } catch {
      if (seq !== loadSeqRef.current) return;
      setRoutes([]);
      setPlant(null);
      setError('Ошибка соединения');
      setSelectedTripId(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [mixerId, day]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.tripId === selectedTripId) ?? null,
    [routes, selectedTripId],
  );

  const mapRoutes: FleetMapRoute[] = useMemo(() => {
    const list: FleetMapRoute[] = [];
    const r = selectedRoute;
    if (!r) return list;

    const planned =
      r.plannedPoints?.length >= 2
        ? r.plannedPoints
        : r.routeSource === 'osrm'
          ? r.points
          : null;
    const actual = r.actualPoints?.length >= 2 ? r.actualPoints : null;

    if (planned) {
      list.push({
        id: `${r.tripId}-plan`,
        color: r.color || '#2563EB',
        label: r.label,
        points: planned,
      });
    } else if (r.points.length >= 2) {
      list.push({
        id: r.tripId,
        color: r.color || '#2563EB',
        label: r.label,
        points: r.points,
        dashed: r.routeSource === 'gps',
      });
    }

    // Факт GPS — яркий оранжевый пунктир (белый на схеме был невидим)
    if (actual && planned) {
      list.push({
        id: `${r.tripId}-gps`,
        color: '#F97316',
        label: `${r.label} · факт`,
        points: actual,
        dashed: true,
        weight: 4,
      });
    }
    return list;
  }, [selectedRoute]);

  const markers: FleetMapMarker[] = useMemo(() => {
    const list: FleetMapMarker[] = [];
    if (plant) {
      list.push({
        id: 'plant',
        lat: plant.lat,
        lon: plant.lon,
        label: 'Завод',
        subtitle: plant.address,
        kind: 'plant',
        color: '#22C55E',
      });
    }
    if (selectedRoute?.destination) {
      list.push({
        id: `dest-${selectedRoute.tripId}`,
        lat: selectedRoute.destination.lat,
        lon: selectedRoute.destination.lon,
        label: `#${selectedRoute.orderId}`,
        subtitle: selectedRoute.address,
        kind: 'destination',
        color: selectedRoute.color,
      });
    }
    if (liveMarker) list.push(liveMarker);
    return list;
  }, [plant, selectedRoute, liveMarker]);

  if (!open) return null;

  return (
    <>
      <style>{`
        .fleet-trip-routes-shell {
          position: fixed;
          inset: 0;
          z-index: 10060;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: max(12px, env(safe-area-inset-top, 0px))
            max(16px, env(safe-area-inset-right, 0px))
            max(12px, env(safe-area-inset-bottom, 0px))
            max(16px, env(safe-area-inset-left, 0px));
          pointer-events: none;
        }
        .fleet-trip-routes-panel {
          pointer-events: auto;
          width: min(1760px, calc(100vw - 32px));
          height: min(calc(100vh - 24px), calc(100dvh - 24px));
          max-height: calc(100dvh - 24px);
          background: #0F172A;
          border-radius: 18px;
          border: 1px solid #334155;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .fleet-trip-routes-header {
          padding: 14px 18px;
          border-bottom: 1px solid #1E2937;
          flex-shrink: 0;
        }
        .fleet-trip-routes-body {
          flex: 1;
          min-height: 0;
          display: flex;
        }
        .fleet-trip-routes-map {
          flex: 1;
          min-width: 0;
          min-height: 0;
          padding: 12px;
          position: relative;
        }
        .fleet-trip-routes-list {
          width: 320px;
          max-width: 40vw;
          border-left: 1px solid #1E2937;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
        }
        .fleet-trip-routes-legend {
          position: absolute;
          left: 24px;
          bottom: 24px;
          z-index: 1000;
          max-width: min(320px, calc(100% - 48px));
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid #334155;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          color: #E2E8F0;
          font-size: 11px;
          line-height: 1.35;
          pointer-events: none;
        }
        .fleet-trip-routes-legend-desktop { display: block; }
        .fleet-trip-routes-legend-mobile { display: none; }
        .fleet-trip-routes-hint-desktop { display: inline; }
        .fleet-trip-routes-hint-mobile { display: none; }

        @media (max-width: 768px) {
          .fleet-trip-routes-shell {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
          }
          .fleet-trip-routes-panel {
            width: 100%;
            height: 100%;
            max-height: 100dvh;
            border-radius: 0;
            border: none;
            box-shadow: none;
          }
          .fleet-trip-routes-header {
            padding: max(10px, env(safe-area-inset-top, 0px)) 12px 10px;
            gap: 8px;
          }
          .fleet-trip-routes-header-title {
            font-size: 15px !important;
          }
          .fleet-trip-routes-header-sub {
            display: none;
          }
          .fleet-trip-routes-body {
            flex-direction: column;
          }
          .fleet-trip-routes-map {
            flex: 1 1 55%;
            min-height: 0;
            padding: 8px 8px 4px;
          }
          .fleet-trip-routes-list {
            width: 100%;
            max-width: none;
            flex: 0 0 auto;
            max-height: min(42vh, 340px);
            border-left: none;
            border-top: 1px solid #1E2937;
            padding: 10px 12px max(12px, env(safe-area-inset-bottom, 0px));
            background: #0F172A;
          }
          .fleet-trip-routes-legend-desktop { display: none; }
          .fleet-trip-routes-legend-mobile {
            display: flex;
            position: absolute;
            left: 16px;
            right: 16px;
            bottom: 12px;
            z-index: 1000;
            gap: 8px;
            flex-wrap: wrap;
            pointer-events: none;
          }
          .fleet-trip-routes-legend-chip {
            padding: 5px 9px;
            border-radius: 9999px;
            background: rgba(15, 23, 42, 0.9);
            border: 1px solid #334155;
            color: #E2E8F0;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.2;
          }
          .fleet-trip-routes-hint-desktop { display: none; }
          .fleet-trip-routes-hint-mobile { display: inline; }
        }
      `}</style>

      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10059, background: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />

      <div className="fleet-trip-routes-shell">
        <div className="fleet-trip-routes-panel">
          <div className="fleet-trip-routes-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <MapPin size={20} color="#38BDF8" style={{ flexShrink: 0 }} />
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
              <div className="fleet-trip-routes-header-title" style={{ fontWeight: 700, color: '#F8FAFC', fontSize: 17 }}>
                Маршруты · {mixerNumber}
              </div>
              <div className="fleet-trip-routes-header-sub" style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>
                План по дорогам (как в заявке) · пунктир — факт GPS
                {gpsSource === 'scout' && ' · СКАУТ'}
                {gpsSource === 'local' && ' · локальный trail'}
              </div>
            </div>
            <input
              type="date"
              value={day}
              onChange={(e) => onDayChange?.(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#1E2937',
                color: '#E2E8F0',
                fontSize: 13,
                flex: '0 1 auto',
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(56,189,248,0.35)',
                background: 'rgba(56,189,248,0.12)',
                color: '#38BDF8',
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? '…' : 'Обновить'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#1E2937',
                color: '#94A3B8',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <X size={20} />
            </button>
          </div>

          <div className="fleet-trip-routes-body">
            <div className="fleet-trip-routes-map">
              {loading && routes.length === 0 ? (
                <div
                  style={{
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#64748B',
                  }}
                >
                  Загрузка маршрутов…
                </div>
              ) : (
                <FleetMap
                  markers={markers}
                  routes={mapRoutes}
                  markerTooltips
                  height="100%"
                  emptyMessage={
                    error ||
                    (routes.length === 0
                      ? 'Нет рейсов за этот день или нет GPS/адресов'
                      : selectedTripId == null
                        ? 'Выбери рейс в списке'
                        : 'Нет координат маршрута')
                  }
                />
              )}

              {/* Легенда desktop — полный блок */}
              {!loading && routes.length > 0 && (
                <div className="fleet-trip-routes-legend fleet-trip-routes-legend-desktop">
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#F8FAFC' }}>
                    Легенда
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 28,
                          height: 0,
                          borderTop: '3px solid #2563EB',
                          flexShrink: 0,
                        }}
                      />
                      <span>Сплошная — план по дорогам (завод → объект)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 28,
                          height: 0,
                          borderTop: '3px dashed #F97316',
                          flexShrink: 0,
                        }}
                      />
                      <span>Пунктир — факт GPS (СКАУТ / trail)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: '#22C55E',
                          flexShrink: 0,
                          boxShadow: '0 0 0 2px #fff',
                        }}
                      />
                      <span>Зелёная точка — завод</span>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        paddingTop: 8,
                        borderTop: '1px solid #334155',
                        color: '#94A3B8',
                      }}
                    >
                      Цвет линии = рейс:
                    </div>
                    {routes.map((r) => (
                      <div
                        key={r.tripId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          opacity:
                            selectedTripId != null && selectedTripId !== r.tripId ? 0.45 : 1,
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: r.color,
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: selectedTripId === r.tripId ? '#F8FAFC' : '#CBD5E1',
                            fontWeight: selectedTripId === r.tripId ? 700 : 500,
                          }}
                        >
                          {r.label}
                          {r.approximate ? ' · схема' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Легенда mobile — компактные чипы */}
              {!loading && routes.length > 0 && (
                <div className="fleet-trip-routes-legend-mobile">
                  <span className="fleet-trip-routes-legend-chip">
                    <span style={{ borderTop: '2px solid #2563EB', display: 'inline-block', width: 16, marginRight: 6, verticalAlign: 'middle' }} />
                    план
                  </span>
                  <span className="fleet-trip-routes-legend-chip">
                    <span style={{ borderTop: '2px dashed #F97316', display: 'inline-block', width: 16, marginRight: 6, verticalAlign: 'middle' }} />
                    GPS
                  </span>
                  <span className="fleet-trip-routes-legend-chip">
                    <span style={{
                      width: 8, height: 8, borderRadius: 999, background: '#22C55E',
                      display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                    }} />
                    завод
                  </span>
                </div>
              )}
            </div>

            <div className="fleet-trip-routes-list scroll-hidden">
              <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4, flexShrink: 0 }}>
                Рейсов: {routes.length}
                {routes.length > 0 && (
                  <>
                    <span className="fleet-trip-routes-hint-desktop" style={{ color: '#64748B' }}>
                      {' '}· на карте выбранный
                    </span>
                    <span className="fleet-trip-routes-hint-mobile" style={{ color: '#64748B' }}>
                      {' '}· тапни рейс
                    </span>
                  </>
                )}
              </div>
              {error && (
                <div style={{ color: '#F87171', fontSize: 12, padding: 8 }}>{error}</div>
              )}
              {routes.map((r) => {
                const active = selectedTripId === r.tripId;
                return (
                  <button
                    key={r.tripId}
                    type="button"
                    onClick={() => setSelectedTripId(r.tripId)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: active
                        ? `1px solid ${r.color}`
                        : '1px solid #334155',
                      background: active ? `${r.color}18` : '#1E2937',
                      cursor: 'pointer',
                      color: '#E2E8F0',
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: r.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</span>
                      <span style={{ marginLeft: 'auto', color: '#64748B', fontSize: 11 }}>
                        {r.volume} м³
                      </span>
                    </div>
                    <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>
                      {r.clientName}
                    </div>
                    <div style={{
                      color: '#64748B',
                      fontSize: 11,
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {r.address}
                    </div>
                    <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
                      {r.status} · {routeSourceLabel(r)}
                    </div>
                  </button>
                );
              })}
              {!loading && routes.length === 0 && !error && (
                <div style={{ color: '#64748B', fontSize: 13, padding: 12 }}>
                  За выбранный день рейсов нет
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
