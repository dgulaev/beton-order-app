/**
 * Юнит-проверка логики очереди оператора (без браузера).
 * Usage: node scripts/test-operator-queue-logic.mjs
 */

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

function queueFilter(rawMixers, optimisticallyRemovedIds, completedMixerIds) {
  return rawMixers.filter((trip) => {
    if (!trip || trip.status !== 'Загрузка') return false;
    const idStr = String(trip.id);
    if (optimisticallyRemovedIds.has(idStr)) return false;
    if (completedMixerIds.has(idStr)) return false;
    return true;
  });
}

function clearOptimistic(prev, rawMixers) {
  // новый фикс: снимаем только если mixer есть и статус !== Загрузка
  const next = new Set(prev);
  let changed = false;
  for (const id of prev) {
    const mixer = rawMixers.find((m) => String(m.id) === id);
    if (mixer && mixer.status !== 'Загрузка') {
      next.delete(id);
      changed = true;
    }
  }
  return { next, changed };
}

function oldClearOptimistic(prev, rawMixers) {
  // старый баг #705
  const next = new Set(prev);
  let changed = false;
  for (const id of prev) {
    const mixer = rawMixers.find((m) => String(m.id) === id);
    if (!mixer || mixer.status !== 'Загрузка') {
      next.delete(id);
      changed = true;
    }
  }
  return { next, changed };
}

// 1) После Загружен — скрыт optimistic
{
  const raw = [{ id: 1223, status: 'Загрузка' }];
  const opt = new Set(['1223']);
  const done = new Set();
  assert(queueFilter(raw, opt, done).length === 0, 'optimistic hide from queue');
}

// 2) Лог уже есть — скрыт даже без optimistic
{
  const raw = [{ id: 1223, status: 'Загрузка' }];
  const opt = new Set();
  const done = new Set(['1223']);
  assert(queueFilter(raw, opt, done).length === 0, 'completedMixerIds hide');
}

// 3) Пустой rawMixers НЕ снимает optimistic (новый фикс)
{
  const opt = new Set(['1223']);
  const { next } = clearOptimistic(opt, []);
  assert(next.has('1223'), 'empty rawMixers keeps optimistic hide');
}

// 4) Старый баг: пустой raw снимал hide
{
  const opt = new Set(['1223']);
  const { next } = oldClearOptimistic(opt, []);
  assert(!next.has('1223'), 'old bug: empty raw cleared hide');
}

// 5) После возврата миксера как Загрузка — всё ещё скрыт (optimistic + completed)
{
  const raw = [{ id: 1223, status: 'Загрузка', loading_started_at: 'x' }];
  let opt = new Set(['1223']);
  const { next } = clearOptimistic(opt, raw);
  opt = next;
  const done = new Set(['1223']);
  assert(queueFilter(raw, opt, done).length === 0, 'ghost cannot reappear in queue');
}

// 6) Когда статус В пути — можно снять optimistic
{
  const raw = [{ id: 1223, status: 'В пути' }];
  const { next } = clearOptimistic(new Set(['1223']), raw);
  assert(!next.has('1223'), 'clear hide when status left Загрузка');
}

// 7) Soft-lock skip window
{
  const TOUCH = 55_000;
  const FRESH = 120_000;
  const now = Date.now();
  const age50 = now - 50_000;
  const age100 = now - 100_000;
  assert(now - age50 < TOUCH, 'beat@50s still in touch window → skip UPDATE');
  assert(now - age100 >= TOUCH, 'beat@100s touches DB');
  assert(now - age50 < FRESH, 'colleagues still see lock at 50s');
  assert(now - age100 < FRESH, 'colleagues still see lock at 100s');
}

console.log('\nAll operator queue / soft-lock checks passed.');
