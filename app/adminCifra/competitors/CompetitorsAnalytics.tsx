'use client';

import type { CSSProperties } from 'react';
import type { CompetitorsAnalytics } from '@/lib/competitorsAnalytics';

type Props = {
  data: CompetitorsAnalytics;
};

const block: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #334155',
  background: 'rgba(15, 23, 42, 0.45)',
  padding: 14,
  boxSizing: 'border-box',
};

export default function CompetitorsAnalyticsPanel({ data }: Props) {
  const top = data.partnerRanking.filter((p) => p.pricedCount > 0).slice(0, 6);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#E2E8F0' }}>
          Аналитика закупки
        </h2>
        <span style={{ color: '#64748B', fontSize: 13 }}>
          если не грузим со своего завода · по актуальным ценам матрицы
        </span>
      </div>

      {data.recommendations.length > 0 && (
        <div style={block}>
          <div style={{ fontWeight: 700, color: '#6EE7B7', marginBottom: 10, fontSize: 14 }}>
            Рекомендации
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#CBD5E1', fontSize: 14, lineHeight: 1.55 }}>
            {data.recommendations.map((r, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
          gap: 10,
        }}
      >
        {data.segmentWinners.map((seg) => (
          <div key={seg.filler} style={block}>
            <div style={{ color: '#94A3B8', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Сегмент · {seg.title}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#F8FAFC', marginBottom: 6 }}>
              {seg.competitorName}
            </div>
            <div style={{ color: '#CBD5E1', fontSize: 14 }}>
              ср. прайс{' '}
              <span style={{ fontWeight: 700, color: '#6EE7B7' }}>
                {seg.avgPrice.toLocaleString('ru-RU')} ₽
              </span>
              {seg.savingsVsOurs != null && seg.savingsVsOurs > 0 && (
                <span style={{ color: '#FCA5A5', marginLeft: 8 }}>
                  −{seg.savingsVsOurs.toLocaleString('ru-RU')} к нам
                </span>
              )}
              {seg.savingsVsOurs != null && seg.savingsVsOurs <= 0 && (
                <span style={{ color: '#94A3B8', marginLeft: 8 }}>мы не дороже</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {data.bestDeals.length > 0 && (
        <div style={{ ...block, overflowX: 'auto' }}>
          <div style={{ fontWeight: 700, color: '#CBD5E1', marginBottom: 10, fontSize: 14 }}>
            Максимальная экономия по маркам (конкурент дешевле нас)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 }}>
            <thead>
              <tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                <th style={th}>Марка</th>
                <th style={th}>Где купить</th>
                <th style={{ ...th, textAlign: 'right' }}>Их цена</th>
                <th style={{ ...th, textAlign: 'right' }}>Наша</th>
                <th style={{ ...th, textAlign: 'right' }}>Экономия</th>
              </tr>
            </thead>
            <tbody>
              {data.bestDeals.map((d) => (
                <tr key={`${d.grade_key}|${d.filler}|${d.competitorId}`}>
                  <td style={td}>{d.label}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#E2E8F0' }}>{d.competitorName}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{d.their.toLocaleString('ru-RU')}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#94A3B8' }}>
                    {d.our.toLocaleString('ru-RU')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#FCA5A5', fontWeight: 700 }}>
                    −{d.savings.toLocaleString('ru-RU')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {top.length > 0 && (
        <div style={{ ...block, overflowX: 'auto' }}>
          <div style={{ fontWeight: 700, color: '#CBD5E1', marginBottom: 6, fontSize: 14 }}>
            Индекс партнёра для закупки
          </div>
          <div style={{ color: '#64748B', fontSize: 12, marginBottom: 10, lineHeight: 1.4 }}>
            Учитывает долю позиций дешевле нас, среднюю экономию и покрытие прайса. Корзина:{' '}
            {data.basketLabels.join(', ') || '—'}.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
            <thead>
              <tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Завод</th>
                <th style={{ ...th, textAlign: 'right' }}>Индекс</th>
                <th style={{ ...th, textAlign: 'right' }}>Дешевле нас</th>
                <th style={{ ...th, textAlign: 'right' }}>Ср. экономия</th>
                <th style={{ ...th, textAlign: 'right' }}>Корзина</th>
                <th style={th}>Точка</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p, i) => (
                <tr key={p.competitorId}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#E2E8F0' }}>{p.competitorName}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#6EE7B7' }}>
                    {p.score}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.cheaperCount}/{p.pricedCount}
                  </td>
                  <td
                    style={{
                      ...td,
                      textAlign: 'right',
                      color: p.avgSavings > 0 ? '#FCA5A5' : '#94A3B8',
                    }}
                  >
                    {p.avgSavings > 0 ? `−${p.avgSavings.toLocaleString('ru-RU')}` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.basketTotal != null ? p.basketTotal.toLocaleString('ru-RU') : '—'}
                    {p.basketVsOurs != null && p.basketVsOurs > 0 && (
                      <span style={{ color: '#FCA5A5', marginLeft: 6, fontSize: 12 }}>
                        (−{p.basketVsOurs.toLocaleString('ru-RU')})
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, color: p.hasCoords ? '#6EE7B7' : '#F59E0B', fontSize: 12 }}>
                    {p.hasCoords ? 'координаты есть' : 'нужны координаты'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.bestDeals.length === 0 && top.every((p) => p.cheaperCount === 0) && (
        <div style={{ color: '#64748B', fontSize: 13, padding: '4px 0' }}>
          По текущим ценам конкуренты не дешевле ТрейдКом — закупка «на стороне» по матрице невыгодна.
        </div>
      )}
    </div>
  );
}

const th: CSSProperties = {
  padding: '8px 8px 8px 0',
  fontWeight: 600,
  borderBottom: '1px solid #334155',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '9px 8px 9px 0',
  borderBottom: '1px solid #1E293B',
  color: '#CBD5E1',
  whiteSpace: 'nowrap',
};
