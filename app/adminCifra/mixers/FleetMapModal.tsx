'use client';

import { useEffect, useState } from 'react';
import { MapPin, RefreshCw, X } from 'lucide-react';
import FleetMap, { FleetMapLegendIcon, type FleetMapMarker } from '../components/FleetMap';

interface Props {
  open: boolean;
  markers: FleetMapMarker[];
  onClose: () => void;
  lastUpdatedAt?: string | null;
  onRefreshAll?: () => void | Promise<void>;
  refreshing?: boolean;
}

function formatUpdatedAgo(iso: string | null | undefined): string {
  if (!iso) return 'данные не загружены';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  // До минуты — «только что» (раньше Math.round давал «1 мин» уже с ~30 сек)
  if (sec < 60) return 'только что';
  const mins = Math.floor(sec / 60);
  if (mins === 1) return '1 мин назад';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 ч назад';
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 день назад' : `${days} дн назад`;
}

export default function FleetMapModal({
  open,
  markers,
  onClose,
  lastUpdatedAt = null,
  onRefreshAll,
  refreshing = false,
}: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Чаще пересчитываем подпись «N мин назад» и сразу после смены lastUpdatedAt
    tick((n) => n + 1);
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [open, lastUpdatedAt]);

  if (!open) return null;

  const onlineCount = markers.filter((m) => m.isOnline).length;
  const offlineCount = markers.length - onlineCount;
  const updatedLabel = formatUpdatedAgo(lastUpdatedAt);
  const isStale = lastUpdatedAt
    ? Date.now() - new Date(lastUpdatedAt).getTime() > 10 * 60_000
    : true;

  return (
    <>
      <style>{`
        .fleet-map-modal-shell {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: max(12px, env(safe-area-inset-top, 0px))
            max(16px, env(safe-area-inset-right, 0px))
            max(12px, env(safe-area-inset-bottom, 0px))
            max(16px, env(safe-area-inset-left, 0px));
          pointer-events: none;
        }

        .fleet-map-modal-panel {
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

        @media (min-width: 1920px) {
          .fleet-map-modal-panel {
            width: min(1840px, calc(100vw - 48px));
            height: min(calc(100vh - 40px), calc(100dvh - 40px));
            max-height: calc(100dvh - 40px);
          }
        }

        @media (min-width: 2560px) {
          .fleet-map-modal-panel {
            width: min(2200px, calc(100vw - 64px));
            height: min(calc(100vh - 48px), calc(100dvh - 48px));
            max-height: calc(100dvh - 48px);
          }
        }

        @media (max-width: 1280px) {
          .fleet-map-modal-panel {
            width: calc(100vw - 20px);
            height: min(calc(100vh - 16px), calc(100dvh - 16px));
            max-height: calc(100dvh - 16px);
            border-radius: 14px;
          }
        }

        @media (max-width: 768px) {
          .fleet-map-modal-shell {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
          }
          .fleet-map-modal-panel {
            width: 100%;
            height: 100%;
            max-height: 100dvh;
            border-radius: 0;
            border: none;
            box-shadow: none;
          }
          .fleet-map-modal-header {
            padding: max(10px, env(safe-area-inset-top, 0px)) 12px 10px !important;
            flex-wrap: wrap;
            gap: 8px !important;
          }
          .fleet-map-modal-header-title {
            font-size: 16px !important;
          }
          .fleet-map-modal-stats {
            gap: 6px !important;
          }
          .fleet-map-modal-stats > span {
            padding: 4px 8px !important;
            font-size: 11px !important;
          }
          .fleet-map-modal-refresh-label {
            display: none;
          }
          .fleet-map-modal-body {
            padding: 6px 8px !important;
          }
          .fleet-map-modal-footer {
            padding: 10px 12px max(12px, env(safe-area-inset-bottom, 0px)) !important;
            gap: 8px !important;
          }
          .fleet-map-modal-legend {
            gap: 12px !important;
          }
          .fleet-map-modal-legend > span {
            font-size: 12px !important;
          }
          .fleet-map-modal-units {
            max-height: 72px;
            overflow-x: auto;
            overflow-y: hidden;
            flex-wrap: nowrap !important;
            -webkit-overflow-scrolling: touch;
          }
        }

        @keyframes fleet-map-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10049, background: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />

      <div className="fleet-map-modal-shell" onClick={onClose}>
        <div className="fleet-map-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div
            className="fleet-map-modal-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderBottom: '1px solid #1E2937',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px 16px', minWidth: 0, flex: 1 }}>
              <div
                className="fleet-map-modal-header-title"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 'clamp(18px, 1.6vw, 24px)',
                  whiteSpace: 'nowrap',
                }}
              >
                <MapPin size={22} color="#4ADE80" />
                Парк на карте
              </div>
              <div className="fleet-map-modal-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span
                  style={{
                    padding: '6px 12px',
                    borderRadius: 9999,
                    background: 'rgba(148,163,184,0.12)',
                    border: '1px solid rgba(148,163,184,0.28)',
                    color: '#E2E8F0',
                    fontSize: 15,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {markers.length} с GPS
                </span>
                <span
                  style={{
                    padding: '6px 12px',
                    borderRadius: 9999,
                    background: 'rgba(74,222,128,0.12)',
                    border: '1px solid rgba(74,222,128,0.35)',
                    color: '#4ADE80',
                    fontSize: 15,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {onlineCount} на связи
                </span>
                {offlineCount > 0 && (
                  <span
                    style={{
                      padding: '6px 12px',
                      borderRadius: 9999,
                      background: 'rgba(148,163,184,0.08)',
                      border: '1px solid rgba(148,163,184,0.22)',
                      color: '#94A3B8',
                      fontSize: 15,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {offlineCount} offline
                  </span>
                )}
                <span
                  style={{
                    padding: '6px 12px',
                    borderRadius: 9999,
                    background: isStale ? 'rgba(251,191,36,0.12)' : 'rgba(148,163,184,0.08)',
                    border: `1px solid ${isStale ? 'rgba(251,191,36,0.35)' : 'rgba(148,163,184,0.22)'}`,
                    color: isStale ? '#FBBF24' : '#94A3B8',
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {updatedLabel}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {onRefreshAll && (
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={() => void onRefreshAll()}
                  aria-label="Обновить GPS"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 9999,
                    border: '1px solid rgba(74,222,128,0.35)',
                    background: 'rgba(74,222,128,0.1)',
                    color: '#4ADE80',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: refreshing ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: refreshing ? 0.75 : 1,
                  }}
                >
                  <RefreshCw
                    size={16}
                    style={refreshing ? { animation: 'fleet-map-spin 0.8s linear infinite' } : undefined}
                  />
                  <span className="fleet-map-modal-refresh-label">
                    {refreshing ? 'Обновление…' : 'Обновить все GPS'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                <X size={22} />
              </button>
            </div>
          </div>

          <div className="fleet-map-modal-body" style={{ flex: 1, minHeight: 0, padding: '12px 14px 14px' }}>
            <FleetMap
              markers={markers}
              height="100%"
              emptyMessage="Нет своей техники с координатами GPS — привяжите UnitId и дождитесь sync"
            />
          </div>

          <div
            className="fleet-map-modal-footer"
            style={{
              padding: '14px 18px 18px',
              borderTop: '1px solid #1E2937',
              background: 'rgba(15,23,42,0.72)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div className="fleet-map-modal-legend" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#F8FAFC',
                }}
              >
                <FleetMapLegendIcon online size={28} vehicleKind="mixer" />
                На связи
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#CBD5E1',
                }}
              >
                <FleetMapLegendIcon online={false} size={28} vehicleKind="mixer" />
                Offline
              </span>
              {markers.some((m) => m.vehicleKind === 'dump_truck') && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  <FleetMapLegendIcon online size={28} vehicleKind="dump_truck" />
                  Самосвал
                </span>
              )}
            </div>
            {markers.length > 0 && (
              <div className="fleet-map-modal-units" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[...markers]
                  .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.label.localeCompare(b.label, 'ru'))
                  .map((m) => (
                    <span
                      key={String(m.id)}
                      title={m.subtitle || m.label}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        color: m.isOnline ? '#4ADE80' : '#E2E8F0',
                        background: m.isOnline ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.25)',
                        border: `1px solid ${m.isOnline ? 'rgba(74,222,128,0.35)' : 'rgba(148,163,184,0.35)'}`,
                      }}
                    >
                      {m.label} · {m.isOnline ? 'online' : 'offline'}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
