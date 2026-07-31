'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { pluralRu } from '@/lib/ruLocale';

export type PlannerFleetMixerMeta = {
  id: number | string;
  number: string;
  volume: number;
  type: string;
  model?: string | null;
  driver?: string | null;
  driverPhone?: string | null;
  tripCount?: number;
};

type Props = {
  mixer: PlannerFleetMixerMeta;
  selected: boolean;
  disabled?: boolean;
  canEdit?: boolean;
  onToggle: () => void;
  fs: (n: number) => number;
  sp: (n: number) => number;
};

type TipPos = { left: number; top: number; placeAbove: boolean };

/** Чип миксера в блоке «Миксеры в расчёт» + тёмный тултип (водитель, марка). */
export default function PlannerFleetMixerChip({
  mixer,
  selected,
  disabled,
  canEdit = true,
  onToggle,
  fs,
  sp,
}: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  const isOwn = mixer.type === 'own';
  const model = String(mixer.model || '').trim() || '—';
  const driver = String(mixer.driver || '').trim() || 'не указан';
  const phone = String(mixer.driverPhone || '').trim();
  const trips = Number(mixer.tripCount) || 0;

  useLayoutEffect(() => {
    if (!hover || !wrapRef.current) {
      setPos(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const placeAbove = rect.bottom + 140 > window.innerHeight;
    setPos({
      left: rect.left + rect.width / 2,
      top: placeAbove ? rect.top - 8 : rect.bottom + 8,
      placeAbove,
    });
  }, [hover]);

  const tipStyle: CSSProperties | null = pos
    ? {
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: pos.placeAbove ? 'translate(-50%, -100%)' : 'translateX(-50%)',
        zIndex: 9999,
        minWidth: 190,
        maxWidth: 280,
        padding: `${sp(10)}px ${sp(12)}px`,
        borderRadius: 12,
        border: '1px solid rgba(71,85,105,0.95)',
        background:
          'linear-gradient(180deg, rgba(30,41,59,0.98) 0%, rgba(15,23,42,0.98) 100%)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
        color: '#E2E8F0',
        fontSize: fs(12),
        fontWeight: 500,
        lineHeight: 1.4,
        textAlign: 'left',
        pointerEvents: 'none',
        whiteSpace: 'normal',
      }
    : null;

  const row = (label: string, value: string, valueColor?: string) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 4,
      }}
    >
      <span style={{ color: '#64748B', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: valueColor || '#E2E8F0',
          fontWeight: 600,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  );

  const tip =
    hover && tipStyle && typeof document !== 'undefined'
      ? createPortal(
          <div style={tipStyle} role="tooltip">
            <div
              style={{
                fontSize: fs(13),
                fontWeight: 700,
                color: '#F1F5F9',
                marginBottom: 2,
              }}
            >
              {mixer.number}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: fs(11),
                  fontWeight: 600,
                  color: isOwn ? '#6EE7B7' : '#FDE047',
                }}
              >
                {isOwn ? 'Свой' : 'Наёмный'}
              </span>
            </div>
            {row('Марка', model)}
            {row('Водитель', driver)}
            {phone ? row('Тел.', phone, '#93C5FD') : null}
            {row(
              'В истории',
              `${trips} ${pluralRu(trips, 'рейс', 'рейса', 'рейсов')}`,
              '#94A3B8',
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        style={{
          padding: `${sp(7)}px ${sp(11)}px`,
          borderRadius: 10,
          border: selected
            ? '1px solid rgba(16,185,129,0.55)'
            : '1px solid rgba(51,65,85,0.9)',
          background: selected ? 'rgba(16,185,129,0.15)' : 'rgba(15,23,42,0.6)',
          color: selected ? '#A7F3D0' : '#94A3B8',
          fontSize: fs(13),
          fontWeight: 600,
          cursor: canEdit ? 'pointer' : 'default',
          opacity: canEdit ? 1 : 0.7,
        }}
      >
        {mixer.number} · {mixer.volume}м³
        {isOwn ? '' : ' ·Н'}
      </button>
      {tip}
    </span>
  );
}
