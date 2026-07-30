'use client';

import type { VehicleKind } from '@/lib/fleetCatalog';
import { fleetInWorkLabel, fleetOpsTabLabel } from '@/lib/orderLogistics';

/** Вкладки операционки по виду техники (Фаза 4). */
const OPS_TABS: VehicleKind[] = ['mixer', 'dump_truck', 'tonar', 'cement_truck'];

type Props = {
  value: VehicleKind;
  onChange: (kind: VehicleKind) => void;
  /** Сколько машин сейчас в рейсе по каждому виду (Загрузка / В пути / На объекте / Проблема). */
  tripCounts?: Partial<Record<VehicleKind, number>>;
};

export default function FleetOpsTabs({ value, onChange, tripCounts }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        marginBottom: 12,
        borderBottom: '1px solid #334155',
        paddingBottom: 6,
        flexShrink: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {OPS_TABS.map((key) => {
        const active = value === key;
        const count = Number(tripCounts?.[key] || 0);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              color: active ? '#10B981' : '#64748B',
              cursor: 'pointer',
              position: 'relative',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
            }}
            title={
              count > 0
                ? `${fleetInWorkLabel(key)}: ${count} в рейсе`
                : fleetInWorkLabel(key)
            }
          >
            <span>{fleetOpsTabLabel(key)}</span>
            {count > 0 && (
              <span
                aria-label={`${count} в рейсе`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  lineHeight: 1,
                  color: active ? '#A7F3D0' : '#CBD5E1',
                  background: active
                    ? 'rgba(16, 185, 129, 0.22)'
                    : 'rgba(148, 163, 184, 0.16)',
                  border: active
                    ? '1px solid rgba(52, 211, 153, 0.45)'
                    : '1px solid rgba(148, 163, 184, 0.28)',
                  boxSizing: 'border-box',
                }}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
            {active && (
              <div
                style={{
                  position: 'absolute',
                  bottom: -4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 5,
                  height: 5,
                  backgroundColor: '#10B981',
                  borderRadius: '50%',
                  boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.3)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export { OPS_TABS };
