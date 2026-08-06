'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { todayMoscowYmd } from '@/lib/fleetService';
import type { ScoutUnitOverview } from '@/lib/integrations/scout/overviewTypes';

type Props = {
  mixerId: number;
  hasScoutUnit: boolean;
  /** Моточасы бочки только для миксеров */
  isMixer?: boolean;
  /** Внешний триггер перезагрузки */
  reloadToken?: number;
};

const box: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: '#1E2937',
  border: '1px solid #334155',
};

const label: CSSProperties = { color: '#64748B', fontSize: 11, marginBottom: 4 };
const value: CSSProperties = { color: '#E2E8F0', fontWeight: 700, fontSize: 15 };

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${suffix}`;
}

function defaultTelemetryPeriod(): { from: string; to: string } {
  const to = todayMoscowYmd();
  const base = new Date(`${to}T12:00:00+03:00`).getTime() - 6 * 86_400_000;
  const from = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(base));
  return { from, to };
}

function softOdoHint(o: ScoutUnitOverview['odometer']): string {
  if (!o) return '—';
  if (o.mileageKm != null) {
    return o.source === 'analog_nav' ? 'пробег по навигации' : o.dayYmd || '—';
  }
  if (o.error === 'NoSensor' || o.error === 'NoData') return 'нет датчика';
  return o.error || '—';
}

export default function FleetScoutOverviewPanel({
  mixerId,
  hasScoutUnit,
  isMixer = true,
  reloadToken = 0,
}: Props) {
  const defaults = defaultTelemetryPeriod();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ScoutUnitOverview | null>(null);

  const load = useCallback(async () => {
    if (!hasScoutUnit) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        mixer_id: String(mixerId),
        from,
        to,
      });
      const res = await fetch(`/api/adminCifra/fleet/scout/overview?${q}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) {
        setError(json.error || 'Не удалось загрузить данные СКАУТ');
        setOverview(null);
        return;
      }
      setOverview(json.overview as ScoutUnitOverview);
    } catch {
      setError('Ошибка соединения');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [mixerId, from, to, hasScoutUnit]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  if (!hasScoutUnit) {
    return (
      <div style={{ color: '#64748B', fontSize: 13 }}>
        Нет привязки СКАУТ — укажи UnitId в паспорте и сохрани.
      </div>
    );
  }

  const o = overview;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid #334155',
            background: '#0F172A',
            color: '#E2E8F0',
            fontSize: 13,
          }}
        />
        <span style={{ color: '#64748B' }}>—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid #334155',
            background: '#0F172A',
            color: '#E2E8F0',
            fontSize: 13,
          }}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid rgba(56,189,248,0.4)',
            background: 'rgba(56,189,248,0.12)',
            color: '#38BDF8',
            fontWeight: 650,
            fontSize: 12,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={14} style={{ opacity: loading ? 0.5 : 1 }} />
          {loading ? 'Обновляю…' : 'Обновить'}
        </button>
      </div>

      {error && <div style={{ color: '#F87171', fontSize: 13 }}>{error}</div>}

      {o && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <div style={box}>
            <div style={label}>Одометр</div>
            <div style={value}>{fmt(o.odometer?.mileageKm, ' км')}</div>
            <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
              {softOdoHint(o.odometer)}
            </div>
          </div>
          <div style={box}>
            <div style={label}>Пробег GPS за период</div>
            <div style={value}>{fmt(o.periodMileage?.totalMileageKm, ' км')}</div>
            <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
              движение {fmt(o.periodMileage?.movementMileageKm, ' км')}
            </div>
          </div>
          <div style={box}>
            <div style={label}>
              {isMixer && o.drumHours?.driveType === 'separate_engine'
                ? 'Двигатель шасси'
                : 'Двигатель'}
            </div>
            <div style={value}>
              {fmt(o.motorModes?.engineOnHours, ' ч')} /{' '}
              {fmt(o.motorModes?.engineIdleHours, ' ч')}
            </div>
            <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
              вкл / холостой
            </div>
          </div>
          {isMixer && (
            <div style={box}>
              <div style={label}>
                {o.drumHours?.driveType === 'separate_engine'
                  ? 'Моточасы двигателя бочки'
                  : 'Моточасы бочки (ВОМ)'}
              </div>
              <div style={value}>{fmt(o.drumHours?.drumOnHours, ' ч')}</div>
              <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
                {o.drumHours?.drumOnHours != null
                  ? [
                      o.drumHours.driveType === 'separate_engine' ? 'отдельный ДВС' : 'ВОМ',
                      o.drumHours.note?.startsWith('за ') ? o.drumHours.note : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'нет данных за период'}
              </div>
            </div>
          )}
          <div style={box}>
            <div style={label}>Топливо ДУТ</div>
            <div style={value}>
              {fmt(o.fuel?.beginFuelVolumeL)} → {fmt(o.fuel?.endFuelVolumeL)} л
            </div>
            <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
              запр. {o.fuel?.fuelingCount ?? 0} · слив {o.fuel?.defuelingCount ?? 0}
              {o.fuel?.totalFuelConsumptionL != null
                ? ` · расход ${fmt(o.fuel.totalFuelConsumptionL, ' л')}`
                : ''}
            </div>
          </div>
          <div style={box}>
            <div style={label}>Уровень бака</div>
            <div style={value}>{fmt(o.analog?.fuelLevelL, ' л')}</div>
          </div>
          <div style={box}>
            <div style={label}>Движение / стоянки</div>
            <div style={value}>
              {o.trackPeriods?.movementCount ?? 0} / {o.trackPeriods?.parkingCount ?? 0}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
