'use client';

import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import AdminPagination from '../components/AdminPagination';

// Высота (visual) для пагинации снизу + небольшой отступ от края экрана.
const BOTTOM_RESERVE = 84;

// Сколько строк списка помещается на экран без прокрутки — измеряем ПО ФАКТУ
// (реальная высота строки и позиция списка), а не по формуле. Так расчёт не
// зависит от масштаба админки, зума браузера, DPI и переносов текста.
// Замеры берём в visual-координатах (getBoundingClientRect) — они согласованы
// с window.innerHeight; высоту строки для распорки отдаём в layout-координатах
// (offsetHeight), чтобы её можно было задать в style.
export function useAutoRows(
  ref: RefObject<HTMLElement | null>,
  {
    minRows = 4,
    reserveBottom = BOTTOM_RESERVE,
    /** Visual gap между строками (flex gap / margin) — учитываем в perPage. */
    rowGap = 0,
    deps = [] as any[],
  }: { minRows?: number; reserveBottom?: number; rowGap?: number; deps?: any[] } = {}
): { perPage: number; rowH: number } {
  const [state, setState] = useState<{ perPage: number; rowH: number }>({ perPage: 10, rowH: 56 });
  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const rowEl = el.querySelector('[data-lab-row]') as HTMLElement | null;
      const headEl = el.querySelector('[data-lab-head]') as HTMLElement | null;
      const rowHLayout = rowEl ? rowEl.offsetHeight : 49;
      if (rowHLayout <= 0) return;
      const headLayout = headEl ? headEl.offsetHeight : 0;
      // Зазор после шапки тоже съедает высоту (gap между head и первой строкой).
      const headGap = headEl && rowGap > 0 ? rowGap : 0;
      // В frame-layout высота списка уже выделена flex'ом — считаем от clientHeight
      // (layout-px). Fallback на innerHeight нужен до первого layout / вне кадра.
      // reserveBottom / SAFETY — чтобы perPage не давал 1px-overflow и лишний скролл на 4K.
      const SAFETY = 4;
      let avail: number;
      if (el.clientHeight >= 40) {
        avail = Math.max(0, el.clientHeight - reserveBottom - SAFETY);
      } else {
        const rect = el.getBoundingClientRect();
        const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
        const safeScale = scale > 0.1 && Number.isFinite(scale) ? scale : 1;
        avail = Math.max(0, (window.innerHeight - rect.top - reserveBottom) / safeScale - SAFETY);
      }
      const step = rowHLayout + rowGap;
      const n = Math.max(minRows, Math.floor((avail - headLayout - headGap + rowGap) / step));
      setState((prev) => (prev.perPage === n && prev.rowH === rowHLayout ? prev : { perPage: n, rowH: rowHLayout }));
    };
    // Несколько отложенных замеров — после появления списка в DOM и после
    // асинхронной загрузки данных (когда высота строки станет известна).
    compute();
    const t1 = setTimeout(compute, 60);
    const t2 = setTimeout(compute, 350);
    const ro = new ResizeObserver(compute);
    if (ref.current) ro.observe(ref.current);
    ro.observe(document.body);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, minRows, reserveBottom, rowGap, ...deps]);
  return state;
}

// То же для «плиток»: измеряем число столбцов (карточки с одинаковым offsetTop
// в первом ряду) и сколько рядов помещается по высоте.
export function useAutoGrid(
  ref: RefObject<HTMLElement | null>,
  { minCards = 4, reserveBottom = BOTTOM_RESERVE, deps = [] as any[] }: { minCards?: number; reserveBottom?: number; deps?: any[] } = {}
): number {
  const [perPage, setPerPage] = useState(12);
  useEffect(() => {
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const cards = Array.from(el.querySelectorAll('[data-lab-card]')) as HTMLElement[];
      if (cards.length === 0) return;
      const cardH = cards[0].offsetHeight;
      if (cardH <= 0) return;
      const firstTop = cards[0].offsetTop;
      const cols = Math.max(1, cards.filter((c) => Math.abs(c.offsetTop - firstTop) < 4).length);
      const gap = 16; // grid gap
      const SAFETY = 4;
      let avail: number;
      if (el.clientHeight >= 40) {
        avail = Math.max(0, el.clientHeight - reserveBottom - SAFETY);
      } else {
        const rect = el.getBoundingClientRect();
        const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
        const safeScale = scale > 0.1 && Number.isFinite(scale) ? scale : 1;
        avail = Math.max(0, (window.innerHeight - rect.top - reserveBottom) / safeScale - SAFETY);
      }
      const rows = Math.max(1, Math.floor((avail + gap) / (cardH + gap)));
      const n = Math.max(minCards, cols * rows);
      setPerPage((prev) => (prev === n ? prev : n));
    };
    compute();
    const t1 = setTimeout(compute, 60);
    const t2 = setTimeout(compute, 350);
    const ro = new ResizeObserver(compute);
    if (ref.current) ro.observe(ref.current);
    ro.observe(document.body);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, minCards, reserveBottom, ...deps]);
  return perPage;
}

/** Пагинация лаборатории — единый AdminPagination. */
export function LabPagination({
  page,
  totalPages,
  onPage,
  style,
  reserveSpace = false,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  style?: CSSProperties;
  /** Держать высоту блока даже при 1 странице — кнопки не прыгают. */
  reserveSpace?: boolean;
}) {
  return (
    <AdminPagination
      page={page}
      totalPages={totalPages}
      onPage={onPage}
      reserveSpace={reserveSpace}
      style={{ marginTop: '16px', ...style }}
    />
  );
}
