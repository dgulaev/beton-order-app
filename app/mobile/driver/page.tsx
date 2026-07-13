'use client';

// Старая прямая ссылка на кабинет водителя. Вход и дашборд теперь общие для
// всех ролей и живут в app/mobile/layout.tsx (единая ссылка /mobile) — этот
// маршрут оставлен только как совместимость со старыми закладками/QR-кодами
// и сразу редиректит на /mobile (сам редирект делает layout, см. isOldDriverLink).

export default function DriverPageRedirect() {
  return null;
}
