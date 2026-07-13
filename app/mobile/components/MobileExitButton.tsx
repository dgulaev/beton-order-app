'use client';

// Кнопка выхода / смены пользователя — встраивается в первую строку каждой
// мобильной страницы (после последней кнопки справа: календарь, "+ Новая" и
// т.п.), а не поверх контента фиксированным оверлеем — иначе она перекрывает
// другие элементы шапки на страницах с собственными кнопками там же.
// Работает одинаково для сотрудника и водителя: чистит обе возможные сессии.
import { LogOut } from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';
import { clearDriverSession } from '../driver/driverClient';

export default function MobileExitButton() {
  const { logout } = useUserRole();

  const handleClick = () => {
    if (!confirm('Выйти и войти как другой пользователь?')) return;
    clearDriverSession();
    logout(); // очищает сессию сотрудника (если была) и перезагружает страницу
  };

  return (
    <button
      onClick={handleClick}
      aria-label="Выйти"
      title="Выйти / сменить пользователя"
      style={{
        background: '#1E2937',
        border: '1px solid #334155',
        borderRadius: '9999px',
        width: '40px',
        height: '40px',
        minWidth: '40px',
        color: '#94A3B8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
      }}
    >
      <LogOut size={18} />
    </button>
  );
}
