'use client';

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { modalFieldStyle, volumeCardSoftStyle } from '../cardStyles';
import {
  formatRuDate,
  pad2,
  pickerItemStyle,
  PortalPopup,
  useDismissOnOutside,
} from './modalPickerShared';

type Props = {
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  allowClear?: boolean;
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function parseIso(iso: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export default function ModalDateInput({
  value,
  onChange,
  style,
  disabled,
  title,
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const selected = parseIso(value);
  const [view, setView] = useState(() => selected || new Date());

  useDismissOnOutside(open, () => setOpen(false), anchorRef, popupRef);

  const days = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const first = new Date(y, m, 1);
    // Monday-first
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: Array<{ day: number; iso: string; inMonth: boolean }> = [];
    for (let i = 0; i < startPad; i++) {
      const d = new Date(y, m, -startPad + i + 1);
      cells.push({ day: d.getDate(), iso: toIso(d), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ day, iso: toIso(new Date(y, m, day)), inMonth: true });
    }
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      const d = new Date(y, m + 1, nextDay++);
      cells.push({ day: d.getDate(), iso: toIso(d), inMonth: false });
    }
    return cells;
  }, [view]);

  const monthLabel = view.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
  const todayIso = toIso(new Date());

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setView(selected || new Date());
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
        <span style={{ color: value ? '#fff' : '#64748B', flex: 1, minWidth: 0 }}>
          {value ? formatRuDate(value) : '—.—.——'}
        </span>
        <Calendar size={15} color="#60A5FA" strokeWidth={2} style={{ flexShrink: 0, marginRight: 2 }} />
      </button>

      <PortalPopup
        open={open}
        anchorRef={anchorRef}
        popupRef={popupRef}
        width={300}
        estimatedHeight={340}
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 0' }}>
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            style={navBtnStyle}
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize', color: '#E2E8F0' }}>
            {monthLabel}
          </div>
          <button
            type="button"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            style={navBtnStyle}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '10px 12px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, color: '#64748B', fontWeight: 600, padding: '4px 0' }}>
                {w}
              </div>
            ))}
            {days.map((c) => {
              const isSel = value === c.iso;
              const isToday = c.iso === todayIso;
              return (
                <button
                  key={c.iso + String(c.inMonth)}
                  type="button"
                  onClick={() => {
                    onChange(c.iso);
                    setOpen(false);
                  }}
                  style={pickerItemStyle(isSel, {
                    padding: '7px 0',
                    borderRadius: 8,
                    border: isSel
                      ? '1px solid rgba(96,165,250,0.55)'
                      : isToday
                        ? '1px solid rgba(148,163,184,0.45)'
                        : '1px solid rgba(148,163,184,0.12)',
                    color: c.inMonth ? (isSel ? '#fff' : '#E2E8F0') : '#64748B',
                    fontSize: 13,
                    fontWeight: isSel || isToday ? 700 : 500,
                  })}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          flexShrink: 0,
          display: 'flex',
          gap: 8,
          borderTop: '1px solid rgba(148,163,184,0.2)',
          padding: '10px 12px 12px',
        }}>
          {allowClear && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              style={footerBtnStyle}
            >
              Очистить
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onChange(todayIso);
              setOpen(false);
            }}
            style={{ ...footerBtnStyle, color: '#60A5FA', marginLeft: 'auto' }}
          >
            Сегодня
          </button>
        </div>
      </PortalPopup>
    </>
  );
}

const navBtnStyle: CSSProperties = volumeCardSoftStyle({
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#94A3B8',
  cursor: 'pointer',
});

const footerBtnStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94A3B8',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '4px 6px',
};
