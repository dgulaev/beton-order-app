'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CARD_BORDER, CARD_GRADIENT_SOFT, CARD_VOLUME_SOFT, MODAL_VOLUME_GLOW, volumeCardSoftStyle } from '../cardStyles';

export const PICKER_Z = 11000;

/** Фон неактивной ячейки — НЕ передавать background: undefined (сбрасывает стиль кнопки в белый). */
export const PICKER_ITEM_BG = 'rgba(15, 23, 42, 0.72)';
export const PICKER_ITEM_BG_HOVER = 'rgba(30, 41, 59, 0.95)';

export function popupPanelStyle(extra: CSSProperties = {}): CSSProperties {
  return volumeCardSoftStyle({
    borderRadius: 14,
    boxShadow: MODAL_VOLUME_GLOW,
    background: CARD_GRADIENT_SOFT,
    color: '#E2E8F0',
    zIndex: PICKER_Z,
    ...extra,
  });
}

/** Ячейка/строка внутри попапа date·time·select. */
export function pickerItemStyle(active: boolean, extra: CSSProperties = {}): CSSProperties {
  return {
    boxSizing: 'border-box',
    border: active ? '1px solid rgba(96,165,250,0.5)' : CARD_BORDER,
    borderRadius: 10,
    background: active
      ? 'linear-gradient(165deg, rgba(59,130,246,0.35) 0%, rgba(30,41,59,0.95) 100%)'
      : PICKER_ITEM_BG,
    boxShadow: active ? CARD_VOLUME_SOFT : 'none',
    color: '#E2E8F0',
    cursor: 'pointer',
    ...extra,
  };
}

export function useDismissOnOutside(
  open: boolean,
  onClose: () => void,
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, popupRef]);
}

export function useAnchorRect(open: boolean, anchorRef: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const update = useCallback(() => {
    if (!anchorRef.current) return;
    setRect(anchorRef.current.getBoundingClientRect());
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return rect;
}

function parseCssPx(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.endsWith('px')) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

type PortalPopupProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  width?: number | 'anchor';
  minWidth?: number;
  /** Оценка высоты для выбора «выше/ниже» якоря. */
  estimatedHeight?: number;
  children: ReactNode;
  style?: CSSProperties;
};

export function PortalPopup({
  open,
  anchorRef,
  popupRef,
  width = 'anchor',
  minWidth,
  estimatedHeight = 320,
  children,
  style,
}: PortalPopupProps) {
  const rect = useAnchorRect(open, anchorRef);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !open || !rect) return null;

  const pad = 8;
  const gap = 6;
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
  const available = Math.max(140, (placeAbove ? spaceAbove : spaceBelow) - gap);

  const styleMax = parseCssPx(style?.maxHeight);
  // Жёсткий лимит по viewport — style.maxHeight не может «вытолкнуть» попап за край.
  const maxH = Math.min(styleMax ?? 360, available);

  const w = width === 'anchor' ? Math.max(rect.width, minWidth ?? 0) : width;
  const left = Math.min(Math.max(pad, rect.left), Math.max(pad, window.innerWidth - w - pad));

  const { maxHeight: _ignoredMaxH, overflow: styleOverflow, ...restStyle } = style || {};

  return createPortal(
    <div
      ref={popupRef as RefObject<HTMLDivElement>}
      style={popupPanelStyle({
        position: 'fixed',
        left,
        top: placeAbove ? undefined : rect.bottom + gap,
        bottom: placeAbove ? window.innerHeight - rect.top + gap : undefined,
        width: w,
        // По умолчанию режем по краю; скролл — у внутреннего контента пикеров.
        overflow: styleOverflow ?? 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        ...restStyle,
        // После style: лимит viewport важнее переданного maxHeight.
        maxHeight: maxH,
      })}
    >
      {children}
    </div>,
    document.body,
  );
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Текущее время HH:MM в Europe/Moscow — дефолт для новых заявок и пикера. */
export function nowTimeHHMM(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = map.hour === '24' ? '00' : (map.hour || '00');
  return `${hour}:${map.minute || '00'}`;
}

export function formatRuDate(iso: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
