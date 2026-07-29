'use client';

import type { CSSProperties } from 'react';
import { volumeCardSoftStyle } from '../cardStyles';

export type ViewModeOption<T extends string = string> = {
  value: T;
  label: string;
  /** Символ/иконка слева от текста, например «≡» или «▦». */
  icon?: string;
};

type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: ViewModeOption<T>[];
  style?: CSSProperties;
};

/**
 * Сегментированный переключатель вида (Список / Плитка) —
 * общий для лаборатории, миксеров, клиентов.
 */
export default function ViewModeToggle<T extends string>({
  value,
  onChange,
  options,
  style,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label="Вид отображения"
      style={volumeCardSoftStyle({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 12,
        flexShrink: 0,
        ...style,
      })}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 12px',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
              background: active ? 'rgba(16, 185, 129, 0.18)' : 'transparent',
              color: active ? '#34D399' : '#94A3B8',
              boxShadow: active ? `inset 0 0 0 1px rgba(52, 211, 153, 0.45)` : 'none',
            }}
          >
            {opt.icon ? (
              <span
                aria-hidden
                style={{
                  fontSize: opt.icon === '≡' ? 16 : 14,
                  lineHeight: 1,
                  opacity: active ? 1 : 0.55,
                }}
              >
                {opt.icon}
              </span>
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Готовые варианты для Список / Плитка. */
export const LIST_GRID_OPTIONS: ViewModeOption<'list' | 'grid'>[] = [
  { value: 'list', label: 'Список', icon: '≡' },
  { value: 'grid', label: 'Плитка', icon: '▦' },
];

/** Готовые варианты для Список / Карточки (клиенты). */
export const TABLE_CARDS_OPTIONS: ViewModeOption<'table' | 'cards'>[] = [
  { value: 'table', label: 'Список', icon: '≡' },
  { value: 'cards', label: 'Карточки', icon: '▦' },
];
