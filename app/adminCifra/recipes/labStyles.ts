// Общие стили модуля «Лаборатория» — держимся тёмной темы админки.
import type { CSSProperties } from 'react';

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

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px',
  background: COLORS.input,
  border: 'none',
  borderRadius: '8px',
  color: '#fff',
  boxSizing: 'border-box',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  color: COLORS.muted,
  fontSize: '14px',
};

export const cardStyle: CSSProperties = {
  background: COLORS.card,
  borderRadius: '16px',
  padding: '16px',
  border: `1px solid ${COLORS.border}`,
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

export const ghostButton: CSSProperties = {
  padding: '10px 18px',
  background: '#334155',
  color: '#E2E8F0',
  border: 'none',
  borderRadius: '9999px',
  fontWeight: 500,
  fontSize: '14px',
  cursor: 'pointer',
};

export const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.9)',
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px',
};

export function modalStyle(maxWidth = 560): CSSProperties {
  return {
    background: COLORS.card,
    padding: '28px',
    borderRadius: '20px',
    width: '100%',
    maxWidth: `${maxWidth}px`,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  };
}
