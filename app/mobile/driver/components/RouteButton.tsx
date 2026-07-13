'use client';

// Кнопка «Маршрут» — открывает Яндекс.Карты (нативное приложение, если
// установлено, иначе веб-версию) с построенным маршрутом от завода до адреса
// доставки. Обычная ссылка <a target="_blank"> — так универсальные ссылки на
// телефоне сами разворачиваются в приложение. Адрес координат "дозревает" в
// фоне (см. useYandexRouteHref) и подставляется в href, поэтому НЕ нужно
// открывать окно вручную через window.open() в onClick — именно это на
// мобильных браузерах (в т.ч. Яндекс.Браузере) оставляло белый экран после
// возврата из приложения Карт.
//
// Пока координаты не готовы (ready === false), клик по кнопке блокируем: в
// Яндекс.Браузере переход по ещё текстовой ссылке открывает приложение БЕЗ
// построения маршрута (см. lib/yandexRoute.ts). Обычно это доли секунды при
// первом показе адреса за сессию — дальше он берётся из кэша мгновенно.
import { Loader2, Navigation } from 'lucide-react';
import { useYandexRouteHref } from '@/lib/yandexRoute';

interface Props {
  address: string | null | undefined;
  compact?: boolean;
}

export default function RouteButton({ address, compact }: Props) {
  const { href, ready } = useYandexRouteHref(address);
  if (!address) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!ready}
      onClick={(e) => {
        e.stopPropagation();
        if (!ready) e.preventDefault();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: '#FFCC0022',
        color: '#FFCC00',
        border: '1px solid #FFCC0055',
        borderRadius: '9999px',
        padding: compact ? '6px 12px' : '10px 16px',
        fontSize: compact ? '13px' : '14px',
        fontWeight: 600,
        textDecoration: 'none',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        opacity: ready ? 1 : 0.6,
        cursor: ready ? 'pointer' : 'wait',
      }}
    >
      {ready ? <Navigation size={compact ? 14 : 16} /> : <Loader2 size={compact ? 14 : 16} style={{ animation: 'spin 1s linear infinite' }} />}
      Маршрут
    </a>
  );
}
