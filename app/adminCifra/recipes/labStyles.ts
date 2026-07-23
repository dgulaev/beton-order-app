// Общие стили модуля «Лаборатория» — держимся тёмной темы админки.
import type { CSSProperties } from 'react';
import {
  CARD_BORDER,
  CARD_GRADIENT,
  CARD_VOLUME,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeCardStyle,
  volumeModalStyle,
} from '../cardStyles';

export const COLORS = {
  bg: '#0F172A',
  card: '#1E2937',
  input: '#25334A',
  border: '#334155',
  text: '#fff',
  muted: '#94A3B8',
  accent: '#4ADE80',
  accentDark: '#10B981',
  blue: '#60A5FA',
  danger: '#F87171',
  amber: '#FACC15',
};

export { volumeCardStyle,
  volumeModalStyle, volumeCardSoftStyle, CARD_BORDER, CARD_GRADIENT, CARD_VOLUME };

export const inputStyle: CSSProperties = modalFieldStyle({
  padding: '12px',
  borderRadius: 10,
});

export const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  color: COLORS.muted,
  fontSize: '14px',
};

export const cardStyle: CSSProperties = {
  ...volumeCardStyle({
    borderRadius: 16,
    padding: '16px',
  }),
};

export function pillStyle(bg: string, color: string): CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: '9999px',
    fontSize: '13px',
    fontWeight: 600,
    background: bg,
    color,
    display: 'inline-block',
  };
}

export function primaryButton(color: string = COLORS.accentDark): CSSProperties {
  return {
    padding: '10px 22px',
    background: color,
    color: 'white',
    border: 'none',
    borderRadius: '9999px',
    fontWeight: 600,
    fontSize: '14.5px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };
}

export const ghostButton: CSSProperties = volumeCardSoftStyle({
  padding: '10px 18px',
  color: '#E2E8F0',
  borderRadius: 9999,
  fontWeight: 500,
  fontSize: '14px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
});

export const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.82)',
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

export function modalStyle(maxWidth = 560): CSSProperties {
  return volumeModalStyle({
    padding: '28px',
    borderRadius: 20,
    width: '100%',
    maxWidth: `${maxWidth}px`,
    maxHeight: '90vh',
    overflowY: 'auto',
  });
}
