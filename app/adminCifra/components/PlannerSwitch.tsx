'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Переключатель для опций интеллекта планирования.
 * Заметнее чекбокса: сразу видно вкл/выкл.
 */

type Accent = 'sky' | 'amber' | 'violet' | 'rose' | 'emerald' | 'slate';

const ACCENT: Record<
  Accent,
  { onTrack: string; onBorder: string; onGlow: string; labelOn: string }
> = {
  sky: {
    onTrack: 'linear-gradient(180deg, #38BDF8 0%, #0284C7 100%)',
    onBorder: 'rgba(125,211,252,0.55)',
    onGlow: 'rgba(56,189,248,0.22)',
    labelOn: '#7DD3FC',
  },
  amber: {
    onTrack: 'linear-gradient(180deg, #FBBF24 0%, #D97706 100%)',
    onBorder: 'rgba(252,211,77,0.55)',
    onGlow: 'rgba(245,158,11,0.22)',
    labelOn: '#FCD34D',
  },
  violet: {
    onTrack: 'linear-gradient(180deg, #A78BFA 0%, #7C3AED 100%)',
    onBorder: 'rgba(196,181,253,0.55)',
    onGlow: 'rgba(167,139,250,0.25)',
    labelOn: '#C4B5FD',
  },
  rose: {
    onTrack: 'linear-gradient(180deg, #F87171 0%, #DC2626 100%)',
    onBorder: 'rgba(254,202,202,0.55)',
    onGlow: 'rgba(248,113,113,0.25)',
    labelOn: '#FCA5A5',
  },
  emerald: {
    onTrack: 'linear-gradient(180deg, #34D399 0%, #059669 100%)',
    onBorder: 'rgba(167,243,208,0.55)',
    onGlow: 'rgba(16,185,129,0.22)',
    labelOn: '#6EE7B7',
  },
  slate: {
    onTrack: 'linear-gradient(180deg, #94A3B8 0%, #64748B 100%)',
    onBorder: 'rgba(203,213,225,0.45)',
    onGlow: 'rgba(148,163,184,0.2)',
    labelOn: '#E2E8F0',
  },
};

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  title?: string;
  accent?: Accent;
  /** Компактный — только ползунок (строки заявок). */
  size?: 'md' | 'sm';
  /** Доп. узел справа от подписи (счётчик и т.п.). */
  suffix?: ReactNode;
  style?: CSSProperties;
};

export default function PlannerSwitch({
  checked,
  onChange,
  disabled,
  label,
  title,
  accent = 'sky',
  size = 'md',
  suffix,
  style,
}: Props) {
  const a = ACCENT[accent];
  const trackW = size === 'sm' ? 32 : 38;
  const trackH = size === 'sm' ? 18 : 22;
  const knob = size === 'sm' ? 14 : 16;
  const knobOnLeft = size === 'sm' ? 16 : 20;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || title || 'Переключатель'}
      title={title || label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 6 : 8,
        padding: label ? (size === 'sm' ? '2px 4px' : '4px 6px 4px 4px') : 2,
        margin: 0,
        border: 'none',
        borderRadius: 999,
        background: 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: trackW,
          height: trackH,
          borderRadius: 999,
          background: checked ? a.onTrack : 'rgba(51,65,85,0.95)',
          border: checked
            ? `1px solid ${a.onBorder}`
            : '1px solid rgba(100,116,139,0.7)',
          boxShadow: checked
            ? `0 0 0 2px ${a.onGlow}, inset 0 1px 2px rgba(255,255,255,0.22)`
            : 'inset 0 1px 3px rgba(0,0,0,0.45)',
          flexShrink: 0,
          transition: 'background 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: size === 'sm' ? 1 : 2,
            left: checked ? knobOnLeft : 2,
            width: knob,
            height: knob,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            transition: 'left 0.15s ease',
          }}
        />
      </span>
      {label ? (
        <span
          style={{
            color: checked ? a.labelOn : '#CBD5E1',
            fontWeight: 600,
            fontSize: size === 'sm' ? 12 : 13,
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
      ) : null}
      {suffix}
    </button>
  );
}
