'use client';
// app/adminCifra/components/OrderViewModal.tsx
// Просмотр уже состоявшейся заявки со страницы «Клиенты» — НЕ редактор.
// Заказ из истории клиента открывается только для просмотра (все поля —
// текст, без input/select), а основная функция модалки — «Дублировать
// заявку»: создать новую заявку на основе этой, с сегодняшней датой
// (см. duplicateOrder в clients/page.tsx). Живое редактирование статусов и
// миксеров живёт только там, где заказ ещё в работе — на странице «Заявки»
// и на дашборде, здесь оно не нужно и намеренно не реализовано.

import type { ReactNode } from 'react';
import { X, Copy } from 'lucide-react';
import OrderRouteMap from './OrderRouteMap';
import ModalActionButton from './ModalActionButton';
import { useMapRouteLinks } from '@/lib/yandexRoute';
import { modalCloseButtonStyle, volumeCardSoftStyle, volumeModalStyle } from '../cardStyles';

interface OrderViewModalProps {
  order: any;
  onClose: () => void;
  // Не передавайте, если у роли нет прав на дублирование — кнопка просто не отрисуется.
  onDuplicate?: (order: any) => void;
}

// Тот же элегантный стиль пилюли, что и на дашборде (OrderDetailModal.tsx) —
// полупрозрачный фон вместо сплошной заливки, без эмодзи в лейбле.
const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  new: { label: 'Новая', color: '#FACC15' },
  processing: { label: 'В работе', color: '#3B82F6' },
  completed: { label: 'Выполнена', color: '#10B981' },
  cancelled: { label: 'Отменена', color: '#EF4444' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || { label: status || '—', color: '#94A3B8' };
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <>
      <div style={{ color: '#94A3B8', fontSize: '13.5px' }}>{label}</div>
      <div style={{ color: '#F1F5F9', fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
    </>
  );
}

export default function OrderViewModal({ order, onClose, onDuplicate }: OrderViewModalProps) {
  const { yandexHref, googleHref, twoGisHref } = useMapRouteLinks(order?.address);

  if (!order) return null;

  const statusStyle = getStatusStyle(order.status);
  const clientName = order.organization_name || order.full_name || '—';
  const deliveryDate = order.delivery_date
    ? new Date(order.delivery_date).toLocaleDateString('ru-RU')
    : null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[880px] lg:max-w-[980px] max-h-[90vh] overflow-auto mx-auto my-10 scroll-hidden"
        style={volumeModalStyle({
          position: 'relative',
          borderRadius: 24,
          padding: '32px',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          title="Закрыть"
          style={modalCloseButtonStyle({
            position: 'absolute',
            top: 26,
            right: 26,
          })}
        >
          <X size={18} />
        </button>

        {/* ==================== ЗАГОЛОВОК + СТАТУС-ПИЛЮЛЯ (read-only) ==================== */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '22px', flexWrap: 'wrap', paddingRight: '48px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', color: '#F1F5F9', whiteSpace: 'nowrap' }}>
            Заявка #{order.id}
          </h2>
          <div style={{
            backgroundColor: statusStyle.color + '20',
            color: statusStyle.color,
            border: `1px solid ${statusStyle.color}40`,
            padding: '7px 16px',
            borderRadius: '9999px',
            fontWeight: 600,
            fontSize: '13px',
            letterSpacing: '0.2px',
            whiteSpace: 'nowrap',
          }}>
            {statusStyle.label}
          </div>
        </div>

        {/* ==================== КАРТА + ПОЛЯ ЗАЯВКИ (read-only) ====================
            items-stretch (а не items-start): высота левой и правой колонки
            всегда равна высоте более высокой из них. У правой заведён
            minHeight, поэтому модалка не "съезжается" в узкую полоску, если
            заказ без комментария или с коротким — просто остаётся пустое
            место внизу карточки. Карта слева — flex:1, поэтому тянется на
            всю эту же высоту и вырастает вместе с модалкой, если комментарий
            длинный и растягивает правую колонку выше minHeight. */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-stretch">

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ flex: 1, minHeight: '220px', borderRadius: '16px', overflow: 'hidden' }}>
              <OrderRouteMap address={order.address} routeHref={yandexHref} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <a href={twoGisHref} target="_blank" rel="noopener noreferrer"
                style={volumeCardSoftStyle({ flex: 1, padding: '9px 8px', color: '#94A3B8', textAlign: 'center', borderRadius: 10, textDecoration: 'none', fontWeight: 600, fontSize: '13px' })}>
                2ГИС
              </a>
              <a href={yandexHref} target="_blank" rel="noopener noreferrer"
                style={volumeCardSoftStyle({ flex: 1, padding: '9px 8px', color: '#94A3B8', textAlign: 'center', borderRadius: 10, textDecoration: 'none', fontWeight: 600, fontSize: '13px' })}>
                Яндекс
              </a>
              <a href={googleHref} target="_blank" rel="noopener noreferrer"
                style={volumeCardSoftStyle({ flex: 1, padding: '9px 8px', color: '#94A3B8', textAlign: 'center', borderRadius: 10, textDecoration: 'none', fontWeight: 600, fontSize: '13px' })}>
                Google
              </a>
            </div>
          </div>

          <div style={volumeCardSoftStyle({ borderRadius: 16, padding: '20px 24px', minHeight: '420px' })}>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '10px 16px', alignItems: 'start' }}>
              <Field label="Клиент" value={clientName} />
              <Field label="ИНН" value={order.inn} />
              <Field label="Телефон" value={order.phone} />
              <Field label="Марка бетона" value={order.grade} />
              <Field label="Объём" value={order.volume ? `${order.volume} м³` : null} />
              <Field label="Дата доставки" value={deliveryDate} />
              <Field label="Время доставки" value={order.delivery_time} />
              <Field label="Адрес доставки" value={order.address} />
              {order.comment && <Field label="Комментарий" value={order.comment} />}
            </div>
          </div>
        </div>

        {/* ==================== КНОПКИ ДЕЙСТВИЙ (единый стиль — как в редакторе заявки на "Заявках") ==================== */}
        <div style={{ marginTop: '28px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {onDuplicate && (
            <ModalActionButton
              color="#6366F1"
              icon={<Copy size={15} />}
              label="Дублировать заявку"
              onClick={() => onDuplicate(order)}
            />
          )}

          <ModalActionButton
            color="#94A3B8"
            icon={<X size={15} />}
            label="Закрыть"
            onClick={onClose}
          />
        </div>
      </div>
    </div>
  );
}
