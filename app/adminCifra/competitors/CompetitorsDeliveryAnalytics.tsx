'use client';

import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  currentMonthRange,
  currentWinterSeason,
  type DeliveryAnalyticsResult,
} from '@/lib/competitorsDeliveryAnalytics';
import ModalDateInput from '../components/ModalDateInput';
import { modalFieldStyle, volumeCardSoftStyle } from '../cardStyles';

const GRID = '1px solid rgba(148, 163, 184, 0.28)';
const GRID_V = '1px solid rgba(148, 163, 184, 0.2)';

const th: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: 'linear-gradient(180deg, #2A3649 0%, #1E2937 100%)',
  color: '#CBD5E1',
  fontWeight: 700,
  fontSize: 12.5,
  padding: '10px 10px',
  borderRight: GRID_V,
  borderBottom: '1px solid rgba(148, 163, 184, 0.42)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '10px 10px',
  background: 'linear-gradient(180deg, rgba(36,48,66,0.95) 0%, rgba(30,41,59,0.98) 100%)',
  borderRight: GRID_V,
  borderBottom: GRID,
  fontSize: 13.5,
  color: '#E2E8F0',
  verticalAlign: 'top',
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CompetitorsDeliveryAnalytics() {
  const initial = currentMonthRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DeliveryAnalyticsResult | null>(null);
  const runSeq = useRef(0);

  const applyCurrentMonth = () => {
    const m = currentMonthRange();
    setFrom(m.from);
    setTo(m.to);
  };

  const applyWinter = () => {
    const w = currentWinterSeason();
    setFrom(w.from);
    setTo(w.to);
  };

  const run = useCallback(async () => {
    const seq = ++runSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/competitors/delivery-analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: adminCifraAuthHeaders(), cache: 'no-store' }
      );
      const json = await res.json().catch(() => ({}));
      if (seq !== runSeq.current) return;
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setData(json as DeliveryAnalyticsResult);
    } catch (e: any) {
      if (seq !== runSeq.current) return;
      setData(null);
      setError(e?.message || 'Ошибка расчёта');
    } finally {
      if (seq === runSeq.current) setLoading(false);
    }
  }, [from, to]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#E2E8F0' }}>
          Доставка · близость и цена
        </h2>
        <span style={{ color: '#64748B', fontSize: 13 }}>
          коэф. = (км/км своего) × (цена/цена своей) · меньше — лучше
        </span>
      </div>

      <div
        style={volumeCardSoftStyle({
          borderRadius: 14,
          padding: 14,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
        })}
      >
        <div>
          <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>С</div>
          <ModalDateInput
            value={from}
            onChange={setFrom}
            style={{ ...modalFieldStyle({ width: 150, marginBottom: 0 }), padding: '8px 10px' }}
          />
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 4 }}>По</div>
          <ModalDateInput
            value={to}
            onChange={setTo}
            style={{ ...modalFieldStyle({ width: 150, marginBottom: 0 }), padding: '8px 10px' }}
          />
        </div>
        <button
          type="button"
          onClick={applyCurrentMonth}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(148,163,184,0.35)',
            background: 'rgba(30,41,59,0.8)',
            color: '#CBD5E1',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13.5,
          }}
        >
          Этот месяц
        </button>
        <button
          type="button"
          onClick={applyWinter}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(148,163,184,0.35)',
            background: 'rgba(30,41,59,0.8)',
            color: '#CBD5E1',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13.5,
          }}
        >
          Эта зима
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || !from || !to}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: loading ? '#334155' : '#10B981',
            color: '#fff',
            fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            fontSize: 14,
            opacity: loading ? 0.75 : 1,
          }}
        >
          {loading ? 'Считаем…' : 'Рассчитать'}
        </button>
        <div style={{ color: '#64748B', fontSize: 12, flex: '1 1 180px', minWidth: 160, lineHeight: 1.4 }}>
          По умолчанию текущий месяц. Расстояние = прямая × коэффициент из тарифов
          (сейчас {data?.meta.roadCurvature ?? '1.3'}).
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(248,113,113,0.12)',
            color: '#FCA5A5',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div style={{ color: '#64748B', fontSize: 14, padding: '8px 2px' }}>
          Выбери период и нажми «Рассчитать». Сегодня: {todayIso()}.
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, color: '#94A3B8', fontSize: 13 }}>
            <span>
              Период: <strong style={{ color: '#E2E8F0' }}>{data.meta.from}</strong>
              {' — '}
              <strong style={{ color: '#E2E8F0' }}>{data.meta.to}</strong>
            </span>
            <span>·</span>
            <span>
              заявок: <strong style={{ color: '#E2E8F0' }}>{data.meta.totalOrders}</strong>
            </span>
            <span>·</span>
            <span>
              с координатами: <strong style={{ color: '#6EE7B7' }}>{data.meta.geocoded}</strong>
            </span>
            {data.meta.withoutCoords > 0 && (
              <>
                <span>·</span>
                <span>
                  без геокода: <strong style={{ color: '#FBBF24' }}>{data.meta.withoutCoords}</strong>
                </span>
              </>
            )}
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 12, border: GRID }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Завод</th>
                  <th style={{ ...th, textAlign: 'center' }}>Лучший коэф.</th>
                  <th style={{ ...th, textAlign: 'center' }}>Ближе всех</th>
                  <th style={{ ...th, textAlign: 'center' }}>Дешевле по марке</th>
                  <th style={{ ...th, textAlign: 'center' }}>Ср. км</th>
                  <th style={{ ...th, textAlign: 'center' }}>Ср. мин</th>
                  <th style={{ ...th, textAlign: 'center' }}>Выборок</th>
                </tr>
              </thead>
              <tbody>
                {data.plants.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 700, color: p.isOwn ? '#34D399' : '#E2E8F0' }}>
                      {p.name}
                      {p.isOwn ? ' (свой)' : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: '#6EE7B7' }}>
                      {p.bestScoreCount}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>{p.nearestCount}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{p.cheapestCount}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {p.avgRoadKm != null ? p.avgRoadKm.toLocaleString('ru-RU') : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {p.avgTravelMin != null ? p.avgTravelMin : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: '#94A3B8' }}>{p.samples}</td>
                  </tr>
                ))}
                {data.plants.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...td, color: '#64748B', textAlign: 'center' }}>
                      Нет заводов с координатами
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontWeight: 700, color: '#CBD5E1', fontSize: 14, marginTop: 4 }}>
            Примеры заявок
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 12, border: GRID }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={th}>Дата</th>
                  <th style={th}>Заявка</th>
                  <th style={th}>Адрес / марка</th>
                  <th style={{ ...th, textAlign: 'center' }}>Свой км</th>
                  <th style={th}>Ближе</th>
                  <th style={th}>Дешевле</th>
                  <th style={{ ...th, textAlign: 'center' }}>Коэф.</th>
                  <th style={th}>Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#94A3B8' }}>
                      {o.delivery_date || '—'}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <strong>#{o.id}</strong>
                      {o.volume != null ? (
                        <span style={{ color: '#94A3B8', marginLeft: 6 }}>{o.volume} м³</span>
                      ) : null}
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        {o.organization_name || '—'}
                      </div>
                      <div style={{ color: '#94A3B8', fontSize: 12.5, lineHeight: 1.35 }}>
                        {o.address}
                      </div>
                      <div style={{ color: '#93C5FD', fontSize: 12.5, marginTop: 3 }}>
                        {o.grade || 'марка не указана'}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {o.ourRoadKm != null ? (
                        <>
                          {o.ourRoadKm}
                          <div style={{ color: '#64748B', fontSize: 11 }}>{o.ourTravelMin} мин</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={td}>
                      {o.nearest ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{o.nearest.name}</div>
                          <div style={{ color: '#94A3B8', fontSize: 12 }}>
                            {o.nearest.roadKm} км · {o.nearest.travelMin} мин
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={td}>
                      {o.cheapest ? (
                        <>
                          <div style={{ fontWeight: 600 }}>{o.cheapest.name}</div>
                          <div style={{ color: '#6EE7B7', fontSize: 12 }}>
                            {Math.round(o.cheapest.price).toLocaleString('ru-RU')} ₽
                          </div>
                        </>
                      ) : (
                        <span style={{ color: '#64748B' }}>нет цены</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {o.best ? (
                        <>
                          <div style={{ color: o.best.isOwn ? '#34D399' : '#FBBF24' }}>
                            {o.best.score.toFixed(2)}
                          </div>
                          <div style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600 }}>
                            {o.best.name}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: '#64748B', fontWeight: 500 }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 12.5, color: '#CBD5E1', lineHeight: 1.4, maxWidth: 320 }}>
                      {o.recommendation}
                    </td>
                  </tr>
                ))}
                {data.orders.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...td, color: '#64748B', textAlign: 'center', padding: 24 }}>
                      {data.meta.totalOrders === 0
                        ? 'За период нет бетонных заявок с адресом.'
                        : 'Не удалось геокодировать адреса за период.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
