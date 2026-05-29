'use client';

import { useState, useEffect } from 'react';
import { useCalendarOrders } from '../hooks/useCalendarOrders';

export default function OperatorBSUPage() {
  // ==================== СОСТОЯНИЯ ====================
  const [currentShift, setCurrentShift] = useState('Дневная смена');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'zayavki' | 'reports' | 'recipes'>('zayavki');

  // ==================== ДАННЫЕ ====================
  const { orders = [], loading } = useCalendarOrders(
    new Date().getFullYear(),
    new Date().getMonth()
  );

  const today = new Date().toISOString().split('T')[0];

  const todayOrders = orders
    .filter((o: any) => {
      const orderDate = o?.delivery_date ? o.delivery_date.split('T')[0] : '';
      return orderDate === today;
    })
    .sort((a: any, b: any) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

  const waitingOrders = todayOrders.filter((o: any) => 
    ['new', 'processing', 'pending', ''].includes((o.status || '').toLowerCase())
  );

  const inLoading = todayOrders.filter((o: any) => o.status === 'loading');

  // ==================== ДЕЙСТВИЯ ====================
  const startLoading = (order: any) => {
    alert(`🚛 Начинаем загрузку заказа #${order.id} — ${order.volume} м³`);
    // TODO: Позже добавить вызов /api/admin/update-status
  };

  const completeLoading = (order: any) => {
    alert(`✅ Загрузка заказа #${order.id} завершена!`);
    // TODO: Позже добавить вызов /api/admin/update-status
  };

  return (
    <div style={{ 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>

      {/* ====================== ВЕРХНЯЯ ПАНЕЛЬ ====================== */}
      <div style={{
        backgroundColor: '#1E2937',
        padding: '20px 40px',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>Бетонный завод</div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>Оператор БСУ • Реальное время</div>
        </div>

        <div style={{ 
          backgroundColor: '#25334A', 
          padding: '12px 24px', 
          borderRadius: '9999px', 
          fontSize: '16px' 
        }}>
          Смена: <span style={{ color: '#10B981', fontWeight: '600' }}>{currentShift}</span>
        </div>
      </div>

      {/* ====================== ОСНОВНОЙ КОНТЕНТ ====================== */}
      <div style={{ padding: '40px' }}>
        <p style={{ color: '#64748B', fontSize: '18px', marginBottom: '32px' }}>
          Управление загрузкой бетона в реальном времени
        </p>

        {/* ====================== МЕНЮ ТАБОВ ====================== */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '40px',
          backgroundColor: 'transparent'
        }}>
          {[
            { key: 'zayavki', label: 'Заявки' },
            { key: 'reports', label: 'Отчеты' },
            { key: 'recipes', label: 'Рецепты' }
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                if (tab.key === 'reports') {
                  window.location.href = '/adminCifra/reports';
                } else if (tab.key === 'recipes') {
                  window.location.href = '/adminCifra/recipes';
                } else {
                  setActiveTab(tab.key as any);
                }
              }}
              style={{
                padding: '14px 36px',
                borderRadius: '9999px',
                backgroundColor: activeTab === tab.key ? '#3B82F6' : 'transparent',
                border: 'none',
                fontSize: '17px',
                fontWeight: activeTab === tab.key ? '700' : '500',
                color: activeTab === tab.key ? 'white' : '#94A3B8',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ====================== КОНТЕНТ Заявок ====================== */}
        {activeTab === 'zayavki' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: '28px' }}>
            
            {/* Очередь на загрузку */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '24px' }}>
                📋 Очередь на загрузку ({waitingOrders.length})
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {waitingOrders.length > 0 ? (
                  waitingOrders.map((order: any) => (
                    <div 
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      style={{
                        backgroundColor: '#25334A',
                        borderRadius: '16px',
                        padding: '16px 20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: '700', color: '#60A5FA', minWidth: '48px' }}>
                          #{order.id}
                        </div>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '16px' }}>
                            {order.organization_name || order.full_name || '—'}
                          </div>
                          <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                            {order.grade} • {order.volume} м³ • {order.delivery_time}
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={(e) => { e.stopPropagation(); startLoading(order); }}
                        style={{
                          backgroundColor: '#10B981',
                          color: 'white',
                          border: 'none',
                          padding: '10px 20px',
                          borderRadius: '9999px',
                          fontWeight: '600',
                          fontSize: '14px'
                        }}
                      >
                        Загрузить
                      </button>
                    </div>
                  ))
                ) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '60px 40px', 
                    color: '#64748B', 
                    fontSize: '17px',
                    backgroundColor: '#25334A',
                    borderRadius: '20px'
                  }}>
                    Очередь пуста. Отличная работа!
                  </div>
                )}
              </div>
            </div>

            {/* Текущая загрузка */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '32px', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: '26px', fontWeight: '600', marginBottom: '24px' }}>⚙️ Текущая загрузка</h2>

              {inLoading.length > 0 ? inLoading.map((order: any) => (
                <div key={order.id} style={{ 
                  backgroundColor: '#334155', 
                  borderRadius: '20px', 
                  padding: '32px',
                  marginBottom: '24px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                      <div style={{ fontSize: '22px', fontWeight: '700' }}>#{order.id} — Загрузка</div>
                      <div style={{ color: '#10B981', fontSize: '19px', marginTop: '4px' }}>
                        {order.volume} м³ • {order.grade}
                      </div>
                    </div>
                    <div style={{ fontSize: '42px', fontWeight: '700', color: '#10B981', fontFamily: 'monospace' }}>
                      00:47
                    </div>
                  </div>

                  <button 
                    onClick={() => completeLoading(order)}
                    style={{
                      width: '100%',
                      backgroundColor: '#10B981',
                      color: 'white',
                      border: 'none',
                      padding: '20px',
                      borderRadius: '9999px',
                      fontSize: '18px',
                      fontWeight: '600'
                    }}
                  >
                    ✅ Завершить загрузку
                  </button>
                </div>
              )) : (
                <div style={{ 
                  flex: 1, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  textAlign: 'center',
                  color: '#64748B',
                  fontSize: '18px'
                }}>
                  Сейчас ничего не загружается<br />Готовы к следующему заказу
                </div>
              )}
            </div>
          </div>
        )}

        {/* Заглушки для других табов */}
        {activeTab === 'recipes' && (
          <div style={{ 
            backgroundColor: '#1E2937', 
            borderRadius: '24px', 
            padding: '80px', 
            textAlign: 'center' 
          }}>
            <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>Рецепты бетона</h2>
            <p style={{ color: '#94A3B8', fontSize: '18px' }}>
              Раздел в разработке
            </p>
          </div>
        )}
      </div>

      {/* ====================== МОДАЛЬНОЕ ОКНО ЗАКАЗА ====================== */}
      {selectedOrder && (
        <div style={{
          position: 'fixed', 
          inset: 0, 
          backgroundColor: 'rgba(0,0,0,0.92)', 
          zIndex: 1000, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center'
        }} onClick={() => setSelectedOrder(null)}>
          
          <div style={{
            backgroundColor: '#1E2937',
            width: '620px',
            borderRadius: '24px',
            padding: '40px',
            maxHeight: '92vh',
            overflow: 'auto'
          }} onClick={e => e.stopPropagation()}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '28px', margin: 0 }}>Заказ #{selectedOrder.id}</h2>
              <span style={{
                padding: '8px 20px',
                borderRadius: '9999px',
                fontSize: '15px',
                fontWeight: '600',
                backgroundColor: '#10B98120',
                color: '#10B981'
              }}>
                {selectedOrder.status === 'new' ? 'Новый' : 
                 selectedOrder.status === 'processing' ? 'В работе' : 'Загрузка'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '17px', lineHeight: '1.7' }}>
              <div><strong>Клиент</strong><br/>{selectedOrder.organization_name || selectedOrder.full_name || '—'}</div>
              <div><strong>Телефон</strong><br/>{selectedOrder.phone || '—'}</div>
              <div><strong>Марка бетона</strong><br/>{selectedOrder.grade}</div>
              <div><strong>Объём</strong><br/><span style={{ color: '#10B981', fontSize: '20px', fontWeight: '700' }}>{selectedOrder.volume} м³</span></div>
              <div><strong>Дата и время</strong><br/>{selectedOrder.delivery_date} в {selectedOrder.delivery_time}</div>
              <div><strong>Адрес доставки</strong><br/>{selectedOrder.address || '—'}</div>
            </div>

            {selectedOrder.comment && (
              <div style={{ marginTop: '28px' }}>
                <strong>Комментарий клиента:</strong>
                <div style={{ 
                  marginTop: '12px', 
                  padding: '20px', 
                  backgroundColor: '#25334A', 
                  borderRadius: '16px',
                  whiteSpace: 'pre-wrap'
                }}>
                  {selectedOrder.comment}
                </div>
              </div>
            )}

            {/* Стоимость */}
            {(selectedOrder.total_price || selectedOrder.concrete_cost) && (
              <div style={{ marginTop: '28px', padding: '20px', backgroundColor: '#25334A', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span>Бетон</span>
                  <span>{(selectedOrder.concrete_cost || 0).toLocaleString()} ₽</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span>Доставка</span>
                  <span>{(selectedOrder.delivery_cost || 0).toLocaleString()} ₽</span>
                </div>
                <div style={{ borderTop: '1px solid #475569', paddingTop: '12px', fontSize: '19px', fontWeight: '700', color: '#60A5FA' }}>
                  Итого: {(selectedOrder.total_price || 0).toLocaleString()} ₽
                </div>
              </div>
            )}

            {/* Кнопки действий */}
            <div style={{ marginTop: '40px', display: 'flex', gap: '16px' }}>
              <button 
                onClick={() => startLoading(selectedOrder)}
                style={{ 
                  flex: 1, 
                  backgroundColor: '#10B981', 
                  color: 'white', 
                  border: 'none', 
                  padding: '20px', 
                  borderRadius: '9999px', 
                  fontSize: '18px', 
                  fontWeight: '600' 
                }}
              >
                🚛 Начать загрузку
              </button>
              <button 
                onClick={() => completeLoading(selectedOrder)}
                style={{ 
                  flex: 1, 
                  backgroundColor: '#3B82F6', 
                  color: 'white', 
                  border: 'none', 
                  padding: '20px', 
                  borderRadius: '9999px', 
                  fontSize: '18px', 
                  fontWeight: '600' 
                }}
              >
                ✅ Завершить загрузку
              </button>
              <button 
                onClick={() => setSelectedOrder(null)}
                style={{ 
                  flex: 1, 
                  backgroundColor: '#334155', 
                  color: 'white', 
                  border: 'none', 
                  padding: '20px', 
                  borderRadius: '9999px', 
                  fontSize: '18px', 
                  fontWeight: '600' 
                }}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}