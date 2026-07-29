'use client';

import type { VehicleKind } from '@/lib/fleetCatalog';
import { fleetInWorkLabel, fleetOpsTabLabel } from '@/lib/orderLogistics';

/** Вкладки операционки по виду техники (Фаза 4). */
const OPS_TABS: VehicleKind[] = ['mixer', 'dump_truck', 'tonar', 'cement_truck'];

type Props = {
  value: VehicleKind;
  onChange: (kind: VehicleKind) => void;
};

export default function FleetOpsTabs({ value, onChange }: Props) {
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
      {OPS_TABS.map((key) => (
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
            color: value === key ? '#10B981' : '#64748B',
            cursor: 'pointer',
            position: 'relative',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          title={fleetInWorkLabel(key)}
        >
          {fleetOpsTabLabel(key)}
          {value === key && (
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
      ))}
    </div>
  );
}

export { OPS_TABS };
