'use client';

// Кнопка «Маршрут» — открывает Яндекс.Карты (нативное приложение, если
// установлено, иначе веб-версию) с построенным маршрутом от завода до адреса
// доставки. Обычная ссылка <a target="_blank"> — так универсальные ссылки на
// телефоне сами разворачиваются в приложение. Адрес координат "дозревает" в
// фоне (см. useYandexRouteHref) и подставляется в href, поэтому НЕ нужно
// открывать окно вручную через window.open() в onClick — именно это на
// мобильных браузерах (в т.ч. Яндекс.Браузере) оставляло белый экран после
// возврата из приложения Карт.
import { Navigation } from 'lucide-react';
import { useYandexRouteHref } from '@/lib/yandexRoute';

interface Props {
  address: string | null | undefined;
  compact?: boolean;
}

export default function RouteButton({ address, compact }: Props) {
  const href = useYandexRouteHref(address);
  if (!address) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
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
      }}
    >
      <Navigation size={compact ? 14 : 16} />
      Маршрут
    </a>
  );
}
