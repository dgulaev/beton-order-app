'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import ModalActionButton from './ModalActionButton';

type Tip = { tone: 'tip' | 'warn' | 'ok'; text: string };
type DayAgg = {
  tripCount: number;
  matched: number;
  earlyStartCount: number;
  lateStartCount: number;
  medianLoadFactMin: number | null;
  medianLoadPlanMin: number | null;
  medianDeltaStartMin: number | null;
  medianCycleDeltaMin: number | null;
  roadSlowCount: number;
  onsiteLongCount: number;
  snapshotQuality: string | null;
};

type InsightsPayload = {
  date: string;
  ready: boolean;
  hint?: string;
  calibrationLabel: string;
  calibration: {
    days: number;
    samples: number;
    loadP50: number | null;
    unloadP50: number | null;
    active: boolean;
  };
  day: DayAgg | null;
  tips: Tip[];
  risks?: Array<{ kind: string; orderId: number | null; mixer: string | null; text: string }>;
};

type Props = {
  dateKey: string;
  uiScale?: number;
  canEdit: boolean;
};

function fmt(n: number | null | undefined, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  const s = r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
  return suffix ? `${s}${suffix}` : s;
}

export default function PlannerInsightsPanel({
  dateKey,
  uiScale = 1,
  canEdit,
}: Props) {
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fs = (n: number) => Math.round(n * uiScale);
  const sp = (n: number) => Math.round(n * uiScale);

  const load = useCallback(async () => {
    if (!dateKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/logistics-plan/insights?date=${encodeURIComponent(dateKey)}`,
        { headers: adminCifraAuthHeaders(), cache: 'no-store' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as InsightsPayload);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить подсказки');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const runLearn = async (backfill: boolean) => {
    if (!canEdit) return;
    setLearning(true);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/logistics-plan/learn', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(backfill ? { backfill: true } : { date: dateKey }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Ошибка обучения');
    } finally {
      setLearning(false);
    }
  };

  const tipColor = (tone: Tip['tone']) =>
    tone === 'warn' ? '#FCA5A5' : tone === 'ok' ? '#34D399' : '#93C5FD';

  return (
    <div
      style={volumeCardStyle({
        borderRadius: 18,
        padding: `${sp(14)}px ${sp(16)}px`,
        flexShrink: 0,
        border: '1px solid rgba(110,231,183,0.22)',
      })}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: sp(10),
          marginBottom: sp(12),
        }}
      >
        <Brain size={fs(22)} color="#6EE7B7" />
        <div style={{ fontSize: fs(18), fontWeight: 800, color: '#F1F5F9', flex: 1 }}>
          Подсказки V2 · план vs факт
        </div>
        <button
          type="button"
          title="Обновить подсказки"
          onClick={() => void load()}
          disabled={loading}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#94A3B8',
            cursor: 'pointer',
            padding: 4,
            display: 'inline-flex',
          }}
        >
          {loading ? (
            <Loader2 size={fs(18)} style={{ animation: 'spin 0.9s linear infinite' }} />
          ) : (
            <RefreshCw size={fs(18)} />
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {error ? (
        <div style={{ color: '#FCA5A5', fontSize: fs(14), fontWeight: 600, marginBottom: sp(10) }}>
          {error}
        </div>
      ) : null}

      {data?.hint ? (
        <div
          style={volumeCardSoftStyle({
            padding: sp(12),
            borderRadius: 12,
            color: '#FCD34D',
            fontSize: fs(14),
            fontWeight: 600,
            marginBottom: sp(12),
          })}
        >
          {data.hint}
        </div>
      ) : null}

      {data?.day ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: sp(10),
            marginBottom: sp(12),
          }}
        >
          {[
            { label: 'Соска факт', value: fmt(data.day.medianLoadFactMin, ' мин') },
            { label: 'Соска план', value: fmt(data.day.medianLoadPlanMin, ' мин') },
            {
              label: 'Старт Δ',
              value:
                data.day.medianDeltaStartMin == null
                  ? '—'
                  : `${data.day.medianDeltaStartMin > 0 ? '+' : ''}${fmt(data.day.medianDeltaStartMin)} мин`,
            },
            { label: 'Матч рейсов', value: `${data.day.matched}/${data.day.tripCount}` },
          ].map((c) => (
            <div
              key={c.label}
              style={volumeCardSoftStyle({
                borderRadius: 12,
                padding: `${sp(10)}px ${sp(12)}px`,
              })}
            >
              <div style={{ color: '#94A3B8', fontSize: fs(12), fontWeight: 600 }}>{c.label}</div>
              <div style={{ color: '#E2E8F0', fontSize: fs(20), fontWeight: 800, marginTop: 4 }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ color: '#94A3B8', fontSize: fs(13), fontWeight: 600, marginBottom: sp(8) }}>
        {data?.calibrationLabel || 'Нормы…'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(8), marginBottom: sp(12) }}>
        {(data?.tips || []).map((t, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: sp(8),
              alignItems: 'flex-start',
              color: tipColor(t.tone),
              fontSize: fs(15),
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            {t.tone === 'warn' ? (
              <AlertTriangle size={fs(16)} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <CheckCircle2 size={fs(16)} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {(data?.risks || []).length > 0 ? (
        <div style={{ marginBottom: sp(12) }}>
          <div style={{ color: '#F87171', fontSize: fs(14), fontWeight: 700, marginBottom: 6 }}>
            Риски
          </div>
          {(data?.risks || []).slice(0, 6).map((r, i) => (
            <div key={i} style={{ color: '#FCA5A5', fontSize: fs(13), fontWeight: 600 }}>
              {r.orderId ? `#${r.orderId}` : '—'}
              {r.mixer ? ` · ${r.mixer}` : ''} — {r.text}
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          color: '#64748B',
          fontSize: fs(12),
          fontWeight: 600,
          marginBottom: sp(10),
          lineHeight: 1.35,
        }}
      >
        Нормы V2 подхватываются сами при «Рассчитать весь день» / «Этап», когда
        калибровка наберёт достаточно рейсов. Здесь только обучение на истории.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(8) }}>
        <ModalActionButton
          color="#60A5FA"
          icon={<RefreshCw size={16} />}
          label={learning ? 'Учусь…' : 'Обновить обучение (день)'}
          size="lg"
          onClick={() => void runLearn(false)}
          disabled={!canEdit || learning}
        />
        <ModalActionButton
          color="#A78BFA"
          icon={<Brain size={16} />}
          label={learning ? 'Учусь…' : 'Backfill 45 дней'}
          size="lg"
          onClick={() => void runLearn(true)}
          disabled={!canEdit || learning}
        />
      </div>
    </div>
  );
}
