# План: Свои vs. Наёмные миксеры в приложении водителя

## Статус: Отложено (обсуждено, не реализовано)

## Текущее состояние

В `DriverMixerInfo` уже есть поле `type: 'own' | 'rented'` — инфраструктура частично готова.
В таблице `mixers` есть колонка `type` (или аналогичная).

## Схема БД — что нужно добавить

```sql
-- Добавить в таблицу order_mixers
ALTER TABLE order_mixers 
  ADD COLUMN IF NOT EXISTS accept_status TEXT DEFAULT NULL;
  -- значения: NULL (не требуется), 'pending', 'accepted', 'rejected'
```

## Сценарий: Свой миксер (`type = 'own'`)

1. Диспетчер назначает миксер → запись в `order_mixers` с `accept_status = 'pending'`
2. Realtime-уведомление прилетает на устройство водителя
3. На карточке рейса появляется кнопка **«Взять загрузку»** (жёлтая)
4. Водитель нажимает → `accept_status = 'accepted'`, статус = 'Загрузка'
5. Запись в историю: "Водитель [имя] принял рейс"

## Сценарий: Наёмный миксер (`type = 'rented'`)

1. Диспетчер назначает → `accept_status = 'pending'`
2. Водитель видит карточку с двумя кнопками:
   - 🟢 **«Взять в работу»** → `accept_status = 'accepted'`, статус = 'Загрузка'
   - 🔴 **«Отказаться»** → `accept_status = 'rejected'`
     - Уведомление диспетчеру (toast + Realtime)
     - Запись в историю заказа
     - Строка в `order_mixers` помечается отказом
3. Диспетчер видит уведомление: "Миксер №XXX отказался от рейса #YYY"

## API

### POST /api/driver/trips/accept
```json
{ "tripId": 123, "decision": "accepted" | "rejected" }
```
- Обновляет `order_mixers.accept_status`
- Если rejected → создаёт запись в `order_history`
- Если rejected → отправляет уведомление через `admin_notifications`

## Фронтенд

### DriverDashboard.tsx
- Если `trip.acceptStatus === 'pending'` → показать специальную карточку с кнопками
- Кнопки блокируются пока идёт запрос

### Sidebar в десктопной админке
- Существующий механизм Realtime подхватит событие `order_mixers UPDATE`
- Показать toast: "Миксер #{номер} отказался от рейса #{id}"

## Уведомления для диспетчера

- Подписаться на `order_mixers` с `filter: accept_status=eq.rejected`
- В `useOrderChangeNotifications` добавить обработчик `onMixerRejected`
- Toast с красной иконкой, счётчик в сайдбаре

## Таймлайн реализации

- [ ] Добавить поле `accept_status` в БД (Supabase migration)
- [ ] API: `/api/driver/trips/accept` (POST)
- [ ] Фронтенд: карточка с кнопками Взять/Отказаться
- [ ] Уведомление диспетчеру при отказе
- [ ] Тесты сценариев с тестовыми миксерами
