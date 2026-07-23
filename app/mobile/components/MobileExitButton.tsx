'use client';

// Кнопка выхода / смены пользователя — встраивается в первую строку каждой
// мобильной страницы (после последней кнопки справа: календарь, "+ Новая" и
// т.п.), а не поверх контента фиксированным оверлеем — иначе она перекрывает
// другие элементы шапки на страницах с собственными кнопками там же.
// Работает одинаково для сотрудника и водителя: чистит обе возможные сессии.
import { LogOut, Eye, Monitor } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useUserRole } from '../../providers/UserRoleProvider';
import { clearDriverSession } from '../driver/driverClient';
import NotificationBell from './NotificationBell';
import { volumeCardSoftStyle } from '@/app/adminCifra/cardStyles';
import { appConfirm } from '@/app/adminCifra/components/appDialog';

const BTN_STYLE: React.CSSProperties = volumeCardSoftStyle({
  borderRadius: 9999,
  width: 40,
  height: 40,
  minWidth: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  cursor: 'pointer',
  padding: 0,
});

function goToDesktopVersion(pathname: string | null) {
  try { localStorage.setItem('adminViewPref', 'desktop'); } catch { /* ignore */ }
  const path = pathname || '/mobile/';
  let next = path.replace(/^\/mobile/, '/adminCifra');
  if (next === '/adminCifra' || next === '/adminCifra/') next = '/adminCifra/dashboard';
  const sep = next.includes('?') ? '&' : '?';
  window.location.assign(`${next}${sep}desktop=true`);
}

export default function MobileExitButton() {
  const { logout } = useUserRole();
  const pathname = usePathname();

  const handleClick = async () => {
    if (!(await appConfirm('Выйти и войти как другой пользователь?', {
      title: 'Смена пользователя',
      okLabel: 'Выйти',
      cancelLabel: 'Отмена',
      variant: 'warning',
    }))) return;
    clearDriverSession();
    logout();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* Колокольчик уведомлений */}
      <NotificationBell />

      {/* Переключение на основную (десктоп) версию админки */}
      <button
        onClick={() => goToDesktopVersion(pathname)}
        title="Основная версия"
        aria-label="Основная версия"
        style={{ ...BTN_STYLE, color: '#A78BFA' }}
      >
        <Monitor size={18} />
      </button>

      {/* Просмотр клиентской формы — ставим флаг чтобы показать кнопку «Назад в админку» */}
      <button
        onClick={() => {
          localStorage.setItem('admin_preview', '1');
          window.open('/', '_blank');
        }}
        title="Клиентская форма заявки"
        style={{ ...BTN_STYLE, color: '#60A5FA' }}
      >
        <Eye size={18} />
      </button>

      {/* Выход */}
      <button
        onClick={handleClick}
        aria-label="Выйти"
        title="Выйти / сменить пользователя"
        style={{ ...BTN_STYLE, color: '#94A3B8' }}
      >
        <LogOut size={18} />
      </button>
    </div>
  );
}
