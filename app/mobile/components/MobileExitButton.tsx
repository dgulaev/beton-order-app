'use client';

// Кнопка выхода / смены пользователя — встраивается в первую строку каждой
// мобильной страницы (после последней кнопки справа: календарь, "+ Новая" и
// т.п.), а не поверх контента фиксированным оверлеем — иначе она перекрывает
// другие элементы шапки на страницах с собственными кнопками там же.
// Работает одинаково для сотрудника и водителя: чистит обе возможные сессии.
import { LogOut, Eye } from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';
import { clearDriverSession } from '../driver/driverClient';

const BTN_STYLE: React.CSSProperties = {
  background: '#1E2937',
  border: '1px solid #334155',
  borderRadius: '9999px',
  width: '40px',
  height: '40px',
  minWidth: '40px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  cursor: 'pointer',
};

export default function MobileExitButton() {
  const { logout } = useUserRole();

  const handleClick = () => {
    if (!confirm('Выйти и войти как другой пользователь?')) return;
    clearDriverSession();
    logout();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
