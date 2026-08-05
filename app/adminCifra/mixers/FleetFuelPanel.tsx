'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Plus, Trash2, Fuel, RefreshCw } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { appConfirm } from '../components/appDialog';
import {
  defaultCostPeriod,
  type FleetCostPeriod,
  type FuelEntry,
} from '@/lib/fleetCosts';
import { formatRub } from '@/lib/fleetTariffs';

interface Props {
  mixerId: number;
  odometerKm?: number | null;
  canMutate: boolean;
  onUpdated?: () => void;
}

type ScoutFuelStats = {
  beginFuelVolumeL: number | null;
  endFuelVolumeL: number | null;
  fuelingTotalVolumeL: number | null;
  defuelingTotalVolumeL: number | null;
  totalFuelConsumptionL: number | null;
  fuelingCount: number;
  defuelingCount: number;
  eventsCount: number;
};

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  fontSize: 13,
};

function scoutStatsCacheKey(mixerId: number, from: string, to: string) {
  return `fleet-scout-fuel-stats:${mixerId}:${from}:${to}`;
}

function readScoutStatsCache(mixerId: number, from: string, to: string): ScoutFuelStats | null {
  try {
    const raw = sessionStorage.getItem(scoutStatsCacheKey(mixerId, from, to));
    if (!raw) return null;
    return JSON.parse(raw) as ScoutFuelStats;
  } catch {
    return null;
  }
}

function writeScoutStatsCache(
  mixerId: number,
  from: string,
  to: string,
  stats: ScoutFuelStats | null,
) {
  try {
    const key = scoutStatsCacheKey(mixerId, from, to);
    if (!stats) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(stats));
  } catch {
    /* private mode / quota */
  }
}

function formatScoutPeriodRu(from: string, to: string): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return `${d}.${m}.${y}`;
  };
  return `${fmt(from)} — ${fmt(to)} (МСК)`;
}

export default function FleetFuelPanel({
  mixerId,
  odometerKm,
  canMutate,
  onUpdated,
}: Props) {
  const defaults = defaultCostPeriod();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [period, setPeriod] = useState<FleetCostPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoutStats, setScoutStats] = useState<ScoutFuelStats | null>(() =>
    typeof window !== 'undefined' ? readScoutStatsCache(mixerId, defaults.from, defaults.to) : null,
  );
  const [scoutHint, setScoutHint] = useState<string | null>(null);
  const [scoutSyncing, setScoutSyncing] = useState(false);
  const scoutQuietSeq = useRef(0);

  const [showForm, setShowForm] = useState(false);
  const [liters, setLiters] = useState('');
  const [amount, setAmount] = useState('');
  const [odo, setOdo] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = `mixer_id=${mixerId}&from=${from}&to=${to}`;
      const [fRes, cRes] = await Promise.all([
        fetch(`/api/adminCifra/fleet/fuel?${q}`, { headers: adminCifraAuthHeaders() }),
        fetch(`/api/adminCifra/fleet/costs?${q}`, { headers: adminCifraAuthHeaders() }),
      ]);
      const fData = await fRes.json();
      const cData = await cRes.json();
      if (!fData.success) {
        setError(fData.error || 'Не удалось загрузить заправки');
        setEntries([]);
      } else {
        setEntries(fData.entries ?? []);
      }
      if (cData.success) setPeriod(cData.period);
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, [mixerId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (odometerKm != null) setOdo(String(odometerKm));
  }, [odometerKm]);

  const create = async () => {
    if (!canMutate) return;
    const L = Number(liters);
    if (!(L > 0)) {
      alert('Укажите литры');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/fleet/fuel', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mixer_id: mixerId,
          liters: L,
          amount_rub: amount || null,
          odometer_km: odo || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Ошибка');
        return;
      }
      setShowForm(false);
      setLiters('');
      setAmount('');
      await load();
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить заправку?'))) return;
    const res = await fetch(`/api/adminCifra/fleet/fuel?id=${id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Ошибка');
      return;
    }
    await load();
  };

  const applyScoutStats = useCallback(
    (stats: ScoutFuelStats | null) => {
      setScoutStats(stats);
      writeScoutStatsCache(mixerId, from, to, stats);
    },
    [mixerId, from, to],
  );

  /** Тихо: сводка ДУТ при открытии/смене периода (+ импорт, если canMutate). */
  const quietRefreshScout = useCallback(async () => {
    const seq = ++scoutQuietSeq.current;
    try {
      const res = await fetch('/api/adminCifra/fleet/fuel/scout-sync', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mixer_id: mixerId,
          from,
          to,
          stats_only: !canMutate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (seq !== scoutQuietSeq.current) return;
      if (data.stats) {
        applyScoutStats(data.stats as ScoutFuelStats);
      }
      if (canMutate && data.success && Number(data.imported) > 0) {
        setScoutHint(
          `СКАУТ: новых заправок +${data.importedFueling ?? data.imported}${
            data.importedDrain ? ` · сливов +${data.importedDrain}` : ''
          }`,
        );
        await load();
        onUpdated?.();
      }
    } catch {
      /* тихий режим — без тоста */
    }
  }, [mixerId, from, to, canMutate, applyScoutStats, load, onUpdated]);

  useEffect(() => {
    const cached = readScoutStatsCache(mixerId, from, to);
    if (cached) setScoutStats(cached);
    else setScoutStats(null);
    void quietRefreshScout();
  }, [mixerId, from, to, quietRefreshScout]);

  const syncFromScout = async () => {
    if (!canMutate) return;
    setScoutSyncing(true);
    setScoutHint(null);
    try {
      const res = await fetch('/api/adminCifra/fleet/fuel/scout-sync', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mixer_id: mixerId, from, to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        setScoutHint(data.error || data.hint || 'Не удалось загрузить из СКАУТ');
        if (data.stats) applyScoutStats(data.stats as ScoutFuelStats);
        return;
      }
      applyScoutStats((data.stats as ScoutFuelStats) ?? null);
      const parts = [
        data.importedFueling != null
          ? `заправок +${data.importedFueling}`
          : `записей +${data.imported ?? 0}`,
        data.importedDrain ? `сливов +${data.importedDrain}` : null,
        data.skipped ? `уже были ${data.skipped}` : null,
        data.stats?.totalFuelConsumptionL != null
          ? `расход ${Number(data.stats.totalFuelConsumptionL).toFixed(1)} л`
          : null,
      ].filter(Boolean);
      setScoutHint(
        data.hint ||
          (parts.length ? `СКАУТ: ${parts.join(' · ')}` : 'СКАУТ: данных за период нет'),
      );
      await load();
      onUpdated?.();
    } catch {
      setScoutHint('Ошибка соединения со СКАУТ');
    } finally {
      setScoutSyncing(false);
    }
  };

  if (loading && !entries.length && !period) {
    return <div style={{ color: '#64748B', padding: 24, textAlign: 'center' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.1)', color: '#F87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...fieldStyle, width: 'auto' }} />
          <span style={{ color: '#64748B' }}>—</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...fieldStyle, width: 'auto' }} />
          {canMutate && (
            <button
              type="button"
              disabled={scoutSyncing}
              onClick={() => void syncFromScout()}
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
                cursor: scoutSyncing ? 'wait' : 'pointer',
              }}
            >
              <RefreshCw size={14} style={{ opacity: scoutSyncing ? 0.6 : 1 }} />
              {scoutSyncing ? 'СКАУТ…' : 'Из СКАУТ'}
            </button>
          )}
        </div>
        <div style={{ color: '#64748B', fontSize: 11, lineHeight: 1.35 }}>
          Период заправок и расхода ДУТ: {formatScoutPeriodRu(from, to)}. По умолчанию — с 1-го
          числа текущего месяца по сегодня (МСК). Сводка СКАУТ подтягивается при открытии вкладки.
        </div>
      </div>

      {scoutHint && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(56,189,248,0.08)',
            border: '1px solid rgba(56,189,248,0.25)',
            color: '#7DD3FC',
            fontSize: 12,
          }}
        >
          {scoutHint}
        </div>
      )}

      {scoutStats && (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: '#1E2937',
            border: '1px solid rgba(56,189,248,0.25)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Расход (ДУТ)</div>
            <div style={{ color: '#E2E8F0', fontWeight: 700 }}>
              {scoutStats.totalFuelConsumptionL != null
                ? `${scoutStats.totalFuelConsumptionL.toFixed(1)} л`
                : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Заправки / сливы</div>
            <div style={{ color: '#E2E8F0', fontWeight: 700 }}>
              {scoutStats.fuelingTotalVolumeL != null
                ? `+${scoutStats.fuelingTotalVolumeL.toFixed(1)} л`
                : '—'}
              {' · '}
              {scoutStats.defuelingTotalVolumeL != null
                ? `−${Math.abs(scoutStats.defuelingTotalVolumeL).toFixed(1)} л`
                : '—'}
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1', color: '#64748B' }}>
            Уровень бака: {scoutStats.beginFuelVolumeL ?? '—'} → {scoutStats.endFuelVolumeL ?? '—'} л
            {scoutStats.defuelingCount > 0
              ? ` · сливов: ${scoutStats.defuelingCount}`
              : ''}
          </div>
        </div>
      )}

      {period && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: '#1E2937',
            border: '1px solid #334155',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Всего затрат</div>
            <div style={{ color: '#F8FAFC', fontWeight: 800, fontSize: 18 }}>
              {formatRub(period.totalRub)}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Стоимость 1 км</div>
            <div style={{ color: '#4ADE80', fontWeight: 800, fontSize: 18 }}>
              {period.costPerKm != null ? formatRub(period.costPerKm) : '—'}
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Топливо</div>
            <div style={{ color: '#E2E8F0', fontWeight: 700 }}>
              {formatRub(period.fuelRub)} · {period.fuelLiters.toFixed(1)} л
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', fontSize: 11 }}>Сервис + расходы</div>
            <div style={{ color: '#E2E8F0', fontWeight: 700 }}>
              {formatRub(period.serviceRub + period.expensesRub)}
            </div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#64748B', fontSize: 11 }}>Расход л/100 км</div>
            <div style={{ color: '#E2E8F0', fontWeight: 700, fontSize: 14 }}>
              {period.litersPer100km != null
                ? `${period.litersPer100km.toFixed(1)} л`
                : '— (нужны одометры на заправках)'}
              {period.fuelNormLPer100km != null && (
                <span style={{ color: '#64748B', fontWeight: 500 }}>
                  {' '}· норма {period.fuelNormLPer100km} л
                  {period.fuelNormDeltaPct != null && (
                    <span
                      style={{
                        color: period.fuelNormDeltaPct > 5 ? '#F87171' : period.fuelNormDeltaPct < -5 ? '#4ADE80' : '#94A3B8',
                        marginLeft: 6,
                      }}
                    >
                      ({period.fuelNormDeltaPct > 0 ? '+' : ''}
                      {period.fuelNormDeltaPct.toFixed(0)}%)
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, color: '#E2E8F0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Fuel size={16} color="#FBBF24" /> Заправки
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 8,
              border: '1px solid rgba(251,191,36,0.35)',
              background: 'rgba(251,191,36,0.1)', color: '#FBBF24',
              fontWeight: 600, fontSize: 12, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Заправка
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ padding: 12, borderRadius: 12, background: '#1E2937', border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input type="number" placeholder="Литры *" value={liters} onChange={(e) => setLiters(e.target.value)} style={fieldStyle} />
          <input type="number" placeholder="Сумма, ₽" value={amount} onChange={(e) => setAmount(e.target.value)} style={fieldStyle} />
          <input type="number" placeholder="Одометр, км" value={odo} onChange={(e) => setOdo(e.target.value)} style={fieldStyle} />
          <button
            type="button"
            disabled={saving}
            onClick={() => void create()}
            style={{ padding: 10, borderRadius: 10, border: 'none', background: '#FBBF24', color: '#0F172A', fontWeight: 700, cursor: 'pointer' }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ color: '#64748B', fontSize: 13 }}>Заправок за период нет</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ padding: 12, borderRadius: 12, background: '#1E2937', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: e.fuel_type === 'drain' ? '#F87171' : '#F8FAFC', fontSize: 14 }}>
                  {e.fuel_type === 'drain' ? '−' : ''}{e.liters} л
                </span>
                <span style={{ color: '#FBBF24', fontWeight: 700, fontSize: 13 }}>
                  {e.amount_rub != null ? formatRub(e.amount_rub) : '—'}
                </span>
                {e.source === 'scout' && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 6,
                      background:
                        e.fuel_type === 'drain'
                          ? 'rgba(248,113,113,0.15)'
                          : 'rgba(56,189,248,0.15)',
                      color: e.fuel_type === 'drain' ? '#F87171' : '#38BDF8',
                    }}
                  >
                    {e.fuel_type === 'drain' ? 'Слив' : 'СКАУТ'}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', color: '#64748B', fontSize: 11 }}>
                  {new Date(e.filled_at).toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>
                {e.odometer_km != null ? `${Math.round(e.odometer_km)} км` : 'без одометра'}
                {e.created_by ? ` · ${e.created_by}` : ''}
              </div>
              {e.receipt_url && (
                <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: '#38BDF8', fontSize: 12 }}>
                  Чек
                </a>
              )}
              {canMutate && (
                <button
                  type="button"
                  onClick={() => void remove(e.id)}
                  style={{ marginTop: 6, background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', padding: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
