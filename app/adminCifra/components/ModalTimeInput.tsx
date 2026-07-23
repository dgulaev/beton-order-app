'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clock } from 'lucide-react';
import { modalFieldStyle } from '../cardStyles';
import { pad2, pickerItemStyle, PortalPopup, useDismissOnOutside } from './modalPickerShared';

type Props = {
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
};

const COL_H = 220;

/** Принимает HH:MM и HH:MM:SS (из БД часто приходит с секундами). */
function parseTime(v: string): { h: number; m: number; ok: boolean } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(String(v || '').trim());
  if (!m) return { h: 9, m: 0, ok: false };
  return {
    h: Math.min(23, Number(m[1])),
    m: Math.min(59, Number(m[2])),
    ok: true,
  };
}

function scrollColToIndex(el: HTMLDivElement | null, idx: number) {
  if (!el) return;
  const child = el.children[idx] as HTMLElement | undefined;
  if (!child) return;
  const top = child.offsetTop - el.clientHeight / 2 + child.clientHeight / 2;
  el.scrollTop = Math.max(0, top);
}

export default function ModalTimeInput({ value, onChange, style, disabled, title }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const minsRef = useRef<HTMLDivElement>(null);
  const { h, m, ok } = parseTime(value);

  // Черновик в открытом попапе — подсветка идёт за курсором, в value пишем сразу.
  const [draftH, setDraftH] = useState(h);
  const [draftM, setDraftM] = useState(m);

  useDismissOnOutside(open, () => setOpen(false), anchorRef, popupRef);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);

  useEffect(() => {
    if (!open) return;
    setDraftH(h);
    setDraftM(m);
    requestAnimationFrame(() => {
      scrollColToIndex(hoursRef.current, h);
      scrollColToIndex(minsRef.current, m);
    });
    // Только при открытии — иначе hover будет дёргать скролл.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Колёсико: крутим колонку под курсором. Нужен passive:false + stopPropagation,
  // иначе layout.blockPageBounce глушит wheel, когда колонка ещё «не скроллится»
  // (или событие уходит в модалку).
  useEffect(() => {
    if (!open) return;
    const bind = (el: HTMLDivElement | null) => {
      if (!el) return () => {};
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        el.scrollTop += e.deltaY;
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    };
    const offH = bind(hoursRef.current);
    const offM = bind(minsRef.current);
    return () => {
      offH();
      offM();
    };
  }, [open]);

  const pick = (nh: number, nm: number) => {
    setDraftH(nh);
    setDraftM(nm);
    onChange(`${pad2(nh)}:${pad2(nm)}`);
  };

  const commitAndClose = () => {
    pick(draftH, draftM);
    setOpen(false);
  };

  const display = ok ? `${pad2(h)}:${pad2(m)}` : '——:——';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        style={{
          ...modalFieldStyle({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            ...style,
          }),
        }}
      >
        <span style={{ color: value ? '#fff' : '#64748B', flex: 1, minWidth: 0 }}>{display}</span>
        <Clock size={15} color="#2DD4BF" strokeWidth={2} style={{ flexShrink: 0, marginRight: 2 }} />
      </button>

      <PortalPopup
        open={open}
        anchorRef={anchorRef}
        popupRef={popupRef}
        width={220}
        estimatedHeight={300}
        style={{ width: 220, padding: 0, overflow: 'hidden' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            height: COL_H,
            minHeight: COL_H,
            maxHeight: COL_H,
            padding: '10px 10px 0',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <div ref={hoursRef} style={colStyle} data-time-col="hours">
            {hours.map((hh) => {
              const active = hh === draftH;
              return (
                <button
                  key={hh}
                  type="button"
                  onMouseEnter={() => pick(hh, draftM)}
                  onClick={() => pick(hh, draftM)}
                  style={cellStyle(active)}
                >
                  {pad2(hh)}
                </button>
              );
            })}
          </div>
          <div ref={minsRef} style={colStyle} data-time-col="mins">
            {minutes.map((mm) => {
              const active = mm === draftM;
              return (
                <button
                  key={mm}
                  type="button"
                  onMouseEnter={() => pick(draftH, mm)}
                  onClick={() => {
                    pick(draftH, mm);
                    setOpen(false);
                  }}
                  style={cellStyle(active)}
                >
                  {pad2(mm)}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 10px 10px',
            borderTop: '1px solid rgba(148,163,184,0.2)',
            background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
          }}
        >
          <button
            type="button"
            onClick={commitAndClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#2DD4BF',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            Готово
          </button>
        </div>
      </PortalPopup>
    </>
  );
}

const colStyle: CSSProperties = {
  height: '100%',
  maxHeight: '100%',
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  display: 'block',
  paddingRight: 2,
  minHeight: 0,
  WebkitOverflowScrolling: 'touch',
};

function cellStyle(active: boolean): CSSProperties {
  return pickerItemStyle(active, {
    display: 'block',
    width: '100%',
    padding: '8px 0',
    marginBottom: 4,
    borderRadius: 8,
    border: active ? '1px solid rgba(45,212,191,0.55)' : '1px solid rgba(148,163,184,0.12)',
    ...(active
      ? {
          background: 'linear-gradient(165deg, rgba(45,212,191,0.32) 0%, rgba(15,23,42,0.95) 100%)',
        }
      : {}),
    color: active ? '#fff' : '#CBD5E1',
    fontSize: 14,
    fontWeight: active ? 700 : 500,
  });
}
