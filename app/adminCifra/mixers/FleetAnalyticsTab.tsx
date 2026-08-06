'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Fuel, Link2, RefreshCw, Upload } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { VEHICLE_KINDS, type VehicleKind } from '@/lib/fleetCatalog';
import { defaultCostPeriod } from '@/lib/fleetCosts';
import {
  ownershipTypeLabel,
  tracksOwnershipCost,
  type FleetAnalyticsOwnVsRented,
  type FleetAnalyticsResult,
  type FleetAnalyticsUnitRow,
} from '@/lib/fleetAnalyticsShared';
import type { FuelReconResult, FuelReconStatus } from '@/lib/fuelRecon';
import { formatRub } from '@/lib/fleetTariffs';
import { volumeCardSoftStyle } from '../cardStyles';

type BenzaImportResult = {
  imported: number;
  pending: number;
  duplicates: number;
  failed: number;
  linkedFromPending: number;
  unmatchedPlates: string[];
  duplicateMixerPlates: string[];
  periodLabel?: string | null;
  hint?: string | null;
  error?: string | null;
};

type Props = {
  onOpenUnit?: (mixerId: number) => void;
};

const fieldStyle: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  fontSize: 15,
};

function formatDowntime(min: number): string {
  if (!min) return '0 мин';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function kindLabel(kind: string): string {
  return VEHICLE_KINDS.find((k) => k.key === kind)?.singular || kind;
}

export default function FleetAnalyticsTab({ onOpenUnit }: Props) {
  const defaults = defaultCostPeriod();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [kind, setKind] = useState<'all' | VehicleKind>('all');
  const [data, setData] = useState<FleetAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [recon, setRecon] = useState<FuelReconResult | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconError, setReconError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BenzaImportResult | null>(null);
  const [linkingPending, setLinkingPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);
  const reconSeq = useRef(0);

  const period = from <= to ? { from, to } : { from: to, to: from };

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      if (kind !== 'all') q.set('vehicle_kind', kind);
      const res = await fetch(`/api/adminCifra/fleet/analytics?${q}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (seq !== loadSeq.current) return;
      if (!json.success) {
        setError(json.error || 'Не удалось загрузить аналитику');
        setData(null);
        return;
      }
      setData({
        kpi: json.kpi,
        byUnit: json.byUnit ?? [],
        ownVsRented: json.ownVsRented ?? [],
        costsByCategory: json.costsByCategory ?? [],
      });
    } catch {
      if (seq !== loadSeq.current) return;
      setError('Ошибка соединения');
      setData(null);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [period.from, period.to, kind]);

  const loadRecon = useCallback(async () => {
    const seq = ++reconSeq.current;
    setReconLoading(true);
    setReconError(null);
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      if (kind !== 'all') q.set('vehicle_kind', kind);
      const res = await fetch(`/api/adminCifra/fleet/fuel/recon?${q}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (seq !== reconSeq.current) return;
      if (!json.success) {
        setReconError(json.error || 'Не удалось загрузить сверку');
        setRecon(null);
        return;
      }
      setRecon({
        from: json.from,
        to: json.to,
        rows: json.rows ?? [],
        summary: json.summary,
        pending: json.pending ?? [],
      });
    } catch {
      if (seq !== reconSeq.current) return;
      setReconError('Ошибка соединения при сверке');
      setRecon(null);
    } finally {
      if (seq === reconSeq.current) setReconLoading(false);
    }
  }, [period.from, period.to, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadRecon();
  }, [loadRecon]);

  const onBenzaFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/adminCifra/fleet/fuel/benza-import', {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      const failed = Number(json.failed) || 0;
      setImportResult({
        imported: Number(json.imported) || 0,
        pending: Number(json.pending) || 0,
        duplicates: Number(json.duplicates) || 0,
        failed,
        linkedFromPending: Number(json.linkedFromPending) || 0,
        unmatchedPlates: Array.isArray(json.unmatchedPlates) ? json.unmatchedPlates : [],
        duplicateMixerPlates: Array.isArray(json.duplicateMixerPlates)
          ? json.duplicateMixerPlates
          : [],
        periodLabel: json.periodLabel ?? null,
        hint: json.hint || null,
        error:
          json.success === false
            ? json.error || json.hint || 'Ошибка импорта'
            : failed > 0
              ? json.error || `Не записано строк: ${failed}`
              : null,
      });
      if (json.success !== false || Number(json.imported) > 0 || Number(json.pending) > 0) {
        void loadRecon();
        void load();
      }
    } catch {
      setImportResult({
        imported: 0,
        pending: 0,
        duplicates: 0,
        failed: 0,
        linkedFromPending: 0,
        unmatchedPlates: [],
        duplicateMixerPlates: [],
        error: 'Ошибка соединения при импорте',
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const linkPending = async () => {
    setLinkingPending(true);
    try {
      const res = await fetch('/api/adminCifra/fleet/fuel/benza-link-pending', {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success && !json.linked) {
        alert(json.error || 'Не удалось привязать ожидающие');
        return;
      }
      alert(
        json.linked
          ? `Привязано заправок: ${json.linked}`
          : 'Нет ожидающих с совпадающим госномером',
      );
      void loadRecon();
      void load();
    } catch {
      alert('Ошибка соединения');
    } finally {
      setLinkingPending(false);
    }
  };

  const exportTable = async () => {
    setExporting(true);
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      if (kind !== 'all') q.set('vehicle_kind', kind);
      const res = await fetch(`/api/adminCifra/fleet/analytics/export?${q}`, {
        headers: adminCifraAuthHeaders(),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || 'Не удалось выгрузить таблицу');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stoimost-vladeniya_${period.from}_${period.to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Ошибка соединения при выгрузке');
    } finally {
      setExporting(false);
    }
  };

  const kpi = data?.kpi;
  const chartData = (data?.costsByCategory ?? []).map((c) => ({
    name: c.label,
    rub: c.rub,
  }));

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingBottom: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={fieldStyle}
        />
        <span style={{ color: '#64748B' }}>—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={fieldStyle}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'all' | VehicleKind)}
          style={{ ...fieldStyle, minWidth: 160 }}
        >
          <option value="all">Все виды</option>
          {VEHICLE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={volumeCardSoftStyle({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 14px',
            borderRadius: 10,
            border: '1px solid #334155',
            background: '#1E2937',
            color: '#E2E8F0',
            fontWeight: 650,
            fontSize: 13,
            cursor: loading ? 'wait' : 'pointer',
          })}
        >
          <RefreshCw size={14} style={{ opacity: loading ? 0.5 : 1 }} />
          Обновить
        </button>
        <button
          type="button"
          onClick={() => void exportTable()}
          disabled={exporting || loading || !data}
          style={volumeCardSoftStyle({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 14px',
            borderRadius: 10,
            border: '1px solid rgba(16,185,129,0.4)',
            background: 'rgba(16,185,129,0.15)',
            color: '#6EE7B7',
            fontWeight: 700,
            fontSize: 13,
            cursor: exporting || loading ? 'wait' : 'pointer',
            marginLeft: 'auto',
          })}
        >
          <Download size={14} />
          {exporting ? 'Выгрузка…' : 'Выгрузить'}
        </button>
      </div>

      <div style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.45 }} className="fleet-analytics-hint">
        Период по умолчанию — с 1-го числа месяца по сегодня (МСК). Загрузка % — дни с
        рейсами у своих доступных ТС (без ремонта / консервации / проданных) / (число ТС ×
        дни периода). Стоимость владения — только свои и техника в аренде в парке (например
        цементовоз); наёмные миксеры не учитываются.
        {from > to ? ' Даты периода переставлены автоматически.' : ''}
      </div>

      <Panel title="Заправки АЗС">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.45 }}>
            Импорт Excel Benza (.xlsx): отпуск с датой/временем или суточный. Сверка со СКАУТ
            ±45 мин, суточный — по дню. Ёмкость АЗС ~26 м³ — ориентир. Лукойл только через
            СКАУТ. Без цены в отчёте Benza не входит в «Стоимость владения» (₽).
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={(e) => void onBenzaFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              style={volumeCardSoftStyle({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid rgba(251,191,36,0.45)',
                background: 'rgba(251,191,36,0.12)',
                color: '#FBBF24',
                fontWeight: 700,
                fontSize: 14,
                cursor: importing ? 'wait' : 'pointer',
              })}
            >
              <Upload size={14} />
              {importing ? 'Импорт…' : 'Загрузить отчёт Benza'}
            </button>
            <button
              type="button"
              disabled={linkingPending || reconLoading}
              onClick={() => void linkPending()}
              style={volumeCardSoftStyle({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0F172A',
                color: '#E2E8F0',
                fontWeight: 650,
                fontSize: 13,
                cursor: linkingPending ? 'wait' : 'pointer',
              })}
            >
              <Link2 size={14} />
              {linkingPending ? 'Привязка…' : 'Привязать ожидающие'}
            </button>
            <button
              type="button"
              disabled={reconLoading}
              onClick={() => void loadRecon()}
              style={volumeCardSoftStyle({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#1E2937',
                color: '#E2E8F0',
                fontWeight: 650,
                fontSize: 13,
                cursor: reconLoading ? 'wait' : 'pointer',
              })}
            >
              <Fuel size={14} />
              Обновить сверку
            </button>
          </div>

          {importResult && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: importResult.error
                  ? 'rgba(248,113,113,0.1)'
                  : 'rgba(16,185,129,0.1)',
                color: importResult.error ? '#F87171' : '#6EE7B7',
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {importResult.error && (
                <div style={{ marginBottom: 6 }}>{importResult.error}</div>
              )}
              <div>
                В историю: {importResult.imported}
                {' · '}
                ожидают ТС: {importResult.pending}
                {' · '}
                дубли: {importResult.duplicates}
                {importResult.failed > 0 ? ` · ошибки: ${importResult.failed}` : ''}
                {importResult.linkedFromPending > 0
                  ? ` · из ожидающих ранее: ${importResult.linkedFromPending}`
                  : ''}
                {importResult.periodLabel ? ` · ${importResult.periodLabel}` : ''}
              </div>
              {importResult.unmatchedPlates.length > 0 && (
                <div style={{ marginTop: 6, color: '#FBBF24' }}>
                  Номера без ТС: {importResult.unmatchedPlates.slice(0, 20).join(', ')}
                  {importResult.unmatchedPlates.length > 20
                    ? ` …ещё ${importResult.unmatchedPlates.length - 20}`
                    : ''}
                </div>
              )}
              {importResult.duplicateMixerPlates.length > 0 && (
                <div style={{ marginTop: 6, color: '#F97316' }}>
                  Дубли госномеров в справочнике: {importResult.duplicateMixerPlates.join(', ')}
                </div>
              )}
              {importResult.hint && (
                <div style={{ marginTop: 6, color: '#94A3B8' }}>{importResult.hint}</div>
              )}
            </div>
          )}

          {reconError && (
            <div style={{ color: '#F87171', fontSize: 13 }}>{reconError}</div>
          )}

          {recon?.summary && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                fontSize: 14,
                color: '#94A3B8',
              }}
            >
              <span>Совпадает: {recon.summary.ok}</span>
              <span style={{ color: '#FBBF24' }}>Расхождение: {recon.summary.mismatch}</span>
              <span style={{ color: '#F87171' }}>Нет СКАУТ: {recon.summary.scoutMissing}</span>
              <span>СКАУТ/Лукойл: {recon.summary.lukoilOrOther}</span>
              <span style={{ color: '#38BDF8' }}>
                Не привязаны: {recon.summary.pendingUnlinked}
                {recon.summary.pendingInPeriod != null
                  ? ` (за период ${recon.summary.pendingInPeriod})`
                  : ''}
              </span>
              {recon.summary.truncated && (
                <span style={{ color: '#F87171' }}>
                  Выборки обрезаны — сузь период
                </span>
              )}
            </div>
          )}

          {(recon?.pending?.length ?? 0) > 0 && (
            <div>
              <div style={{ fontWeight: 650, fontSize: 15, color: '#F8FAFC', marginBottom: 8 }}>
                Не привязаны (все ожидающие)
              </div>
              <div style={{ color: '#64748B', fontSize: 13, marginBottom: 8 }}>
                Список не режется периодом сверху. Добавь ТС с этим госномером — заправка
                подтянется (или «Привязать ожидающие»).
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 260, WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: '#64748B', textAlign: 'left' }}>
                      <th style={th}>Госномер</th>
                      <th style={th}>Дата и время</th>
                      <th style={th}>Литры</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon!.pending.map((p) => (
                      <tr key={p.id} style={{ borderTop: '1px solid #334155' }}>
                        <td style={{ ...td, fontWeight: 700, color: '#FBBF24' }}>
                          {p.plateRaw}
                        </td>
                        <td style={td}>
                          {new Date(p.filledAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td style={td}>{p.liters} л</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <div style={{ fontWeight: 650, fontSize: 15, color: '#F8FAFC', marginBottom: 8 }}>
              Сверка Benza ↔ СКАУТ
              {reconLoading ? '…' : ''}
            </div>
            {!recon?.rows?.length ? (
              <div style={{ color: '#64748B', fontSize: 14 }}>
                {reconLoading ? 'Загрузка сверки…' : 'Нет заправок Benza/СКАУТ за период'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 420, WebkitOverflowScrolling: 'touch' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 14,
                    minWidth: 640,
                  }}
                >
                  <thead>
                    <tr style={{ color: '#64748B', textAlign: 'left' }}>
                      <th style={th}>Дата</th>
                      <th style={th}>ТС</th>
                      <th style={th}>Benza, л</th>
                      <th style={th}>СКАУТ, л</th>
                      <th style={th}>Δ</th>
                      <th style={th}>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.rows.map((r) => {
                      const bg = reconRowBg(r.status);
                      return (
                        <tr
                          key={r.id}
                          style={{
                            borderTop: '1px solid #334155',
                            background: bg,
                          }}
                        >
                          <td style={td}>
                            {new Date(r.atIso).toLocaleString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td
                            style={{
                              ...td,
                              fontWeight: 650,
                              color: '#F8FAFC',
                              cursor: r.mixerId && onOpenUnit ? 'pointer' : 'default',
                            }}
                            onClick={() => {
                              if (r.mixerId && onOpenUnit) onOpenUnit(r.mixerId);
                            }}
                          >
                            {r.plate}
                          </td>
                          <td style={td}>{r.benzaLiters != null ? r.benzaLiters : '—'}</td>
                          <td style={td}>{r.scoutLiters != null ? r.scoutLiters : '—'}</td>
                          <td style={td}>
                            {r.deltaLiters != null
                              ? `${r.deltaLiters > 0 ? '+' : ''}${r.deltaLiters}`
                              : '—'}
                          </td>
                          <td style={{ ...td, color: reconStatusColor(r.status) }}>
                            {r.statusLabel}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: 'rgba(248,113,113,0.1)',
            color: '#F87171',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ color: '#64748B', padding: 40, textAlign: 'center' }}>Загрузка…</div>
      ) : kpi ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 14,
            }}
            className="fleet-analytics-kpi"
          >
            <KpiCard
              label="Загрузка"
              value={
                kpi.utilizationPct != null ? `${kpi.utilizationPct.toFixed(1)}%` : '—'
              }
              hint={`${kpi.tripUnitDays} / ${kpi.availableUnitDays} машино-дней`}
            />
            <KpiCard
              label="Простой"
              value={formatDowntime(kpi.downtimeMin)}
              hint="сумма по завершённым рейсам"
            />
            <KpiCard
              label="На ремонте"
              value={String(kpi.repairCount)}
              hint="сейчас, среди учитываемых ТС"
              accent="#F97316"
            />
            <KpiCard
              label="Стоимость владения"
              value={formatRub(kpi.totalRub)}
              hint={`топливо ${formatRub(kpi.fuelRub)} · ТО ${formatRub(kpi.serviceRub)}`}
              accent="#4ADE80"
            />
          </div>

          <div className="fleet-analytics-mid">
            <Panel title="Структура затрат">
              {chartData.every((c) => !c.rub) ? (
                <div style={{ color: '#64748B', fontSize: 13, padding: 24, textAlign: 'center' }}>
                  Нет затрат за период
                </div>
              ) : (
                <div style={{ width: '100%', height: 260 }} className="fleet-analytics-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 13 }} />
                      <YAxis
                        tick={{ fill: '#94A3B8', fontSize: 12 }}
                        tickFormatter={(v) =>
                          Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}к` : String(v)
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0F172A',
                          border: '1px solid #334155',
                          borderRadius: 8,
                          color: '#E2E8F0',
                          fontSize: 14,
                        }}
                        formatter={(value) => [formatRub(Number(value) || 0), 'Сумма']}
                      />
                      <Bar dataKey="rub" fill="#38BDF8" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Свои и в аренде">
              <OwnVsRentedTable rows={data?.ownVsRented ?? []} />
            </Panel>
          </div>

          <Panel title={`Стоимость владения по единицам (${data?.byUnit.length ?? 0})`}>
            <UnitsTable units={data?.byUnit ?? []} onOpenUnit={onOpenUnit} />
          </Panel>
        </>
      ) : null}

      <style>{`
        .fleet-analytics-mid {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) minmax(280px, 1.2fr);
          gap: 14px;
        }
        @media (max-width: 1100px) {
          .fleet-analytics-mid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 720px) {
          .fleet-analytics-kpi {
            grid-template-columns: 1fr 1fr !important;
          }
          .fleet-analytics-chart {
            height: 220px !important;
          }
        }
        @media (max-width: 480px) {
          .fleet-analytics-kpi {
            grid-template-columns: 1fr !important;
          }
          .fleet-analytics-hint {
            font-size: 13px !important;
          }
        }
      `}</style>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent = '#F8FAFC',
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 14,
        background: '#1E2937',
        border: '1px solid #334155',
      }}
    >
      <div style={{ color: '#94A3B8', fontSize: 14, marginBottom: 8, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ color: accent, fontWeight: 800, fontSize: 28, lineHeight: 1.15 }}>{value}</div>
      {hint && (
        <div style={{ color: '#64748B', fontSize: 13, marginTop: 10, lineHeight: 1.4 }}>{hint}</div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 14,
        background: '#1E2937',
        border: '1px solid #334155',
        minWidth: 0,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, color: '#F8FAFC', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function reconRowBg(status: FuelReconStatus): string | undefined {
  if (status === 'mismatch') return 'rgba(251,191,36,0.08)';
  if (status === 'scout_missing') return 'rgba(248,113,113,0.08)';
  return undefined;
}

function reconStatusColor(status: FuelReconStatus): string {
  if (status === 'ok') return '#6EE7B7';
  if (status === 'mismatch') return '#FBBF24';
  if (status === 'scout_missing') return '#F87171';
  return '#94A3B8';
}

function OwnVsRentedTable({ rows }: { rows: FleetAnalyticsOwnVsRented[] }) {
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
        <thead>
          <tr style={{ color: '#64748B', textAlign: 'left' }}>
            <th style={th}>Тип</th>
            <th style={th}>Ед.</th>
            <th style={th}>Рейсы</th>
            <th style={th}>м³</th>
            <th style={th}>Простой</th>
            <th style={th}>Затраты</th>
            <th style={th}>₽/рейс</th>
            <th style={th}>₽/м³</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} style={{ borderTop: '1px solid #334155' }}>
              <td style={td}>{r.type === 'own' ? 'Свои' : 'В аренде'}</td>
              <td style={td}>{r.units}</td>
              <td style={td}>{r.trips}</td>
              <td style={td}>{r.volumeM3}</td>
              <td style={td}>{formatDowntime(r.downtimeMin)}</td>
              <td style={td}>{formatRub(r.totalRub)}</td>
              <td style={td}>{r.rubPerTrip != null ? formatRub(r.rubPerTrip) : '—'}</td>
              <td style={td}>{r.rubPerM3 != null ? formatRub(r.rubPerM3) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitsTable({
  units,
  onOpenUnit,
}: {
  units: FleetAnalyticsUnitRow[];
  onOpenUnit?: (mixerId: number) => void;
}) {
  if (!units.length) {
    return (
      <div style={{ color: '#64748B', fontSize: 15, padding: 16, textAlign: 'center' }}>
        Нет единиц за выбранный фильтр
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, minWidth: 920 }}>
        <thead>
          <tr style={{ color: '#64748B', textAlign: 'left' }}>
            <th style={th}>Номер</th>
            <th style={th}>Вид</th>
            <th style={th}>Тип</th>
            <th style={th}>Топливо</th>
            <th style={th}>ТО</th>
            <th style={th}>Расходы</th>
            <th style={th}>Итого</th>
            <th style={th}>₽/км</th>
            <th style={th}>Рейсы</th>
            <th style={th}>м³</th>
            <th style={th}>Простой</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => {
            const clickable = Boolean(
              onOpenUnit &&
                tracksOwnershipCost({ type: u.type, vehicleKind: u.vehicleKind }),
            );
            return (
              <tr
                key={u.mixerId}
                style={{
                  borderTop: '1px solid #334155',
                  cursor: clickable ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (clickable) onOpenUnit?.(u.mixerId);
                }}
                title={clickable ? 'Открыть карточку ТС' : undefined}
              >
                <td style={{ ...td, fontWeight: 700, color: '#F8FAFC' }}>
                  {u.number}
                  {u.lifecycleStatus === 'repair' && (
                    <span style={{ marginLeft: 8, color: '#F97316', fontSize: 11 }}>ремонт</span>
                  )}
                </td>
                <td style={td}>{kindLabel(u.vehicleKind)}</td>
                <td style={td}>{ownershipTypeLabel(u.type)}</td>
                <td style={td}>{formatRub(u.fuelRub)}</td>
                <td style={td}>{formatRub(u.serviceRub)}</td>
                <td style={td}>{formatRub(u.expensesRub)}</td>
                <td style={{ ...td, fontWeight: 700, color: '#4ADE80' }}>
                  {formatRub(u.totalRub)}
                </td>
                <td style={td}>{u.costPerKm != null ? formatRub(u.costPerKm) : '—'}</td>
                <td style={td}>{u.trips}</td>
                <td style={td}>{u.volumeM3}</td>
                <td style={td}>{formatDowntime(u.downtimeMin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th: CSSProperties = {
  padding: '10px 12px',
  fontWeight: 650,
  whiteSpace: 'nowrap',
  fontSize: 13,
};

const td: CSSProperties = {
  padding: '12px 12px',
  color: '#CBD5E1',
  whiteSpace: 'nowrap',
  fontSize: 15,
};
