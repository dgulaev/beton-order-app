/**
 * Доступ к сценарию «торги / обработка»:
 * — все админы;
 * — сотрудники с флагом users.can_process_tenders (галочка в карточке сотрудника).
 *
 * Сюда входят: Обработка на Спросе/Лидах, создание лида с площадки,
 * загрузка контрактов, отправка спроса в лиды, назначение исполнителей
 * и соисполнителей.
 *
 * Обычные менеджеры без флага эти действия не выполняют.
 */

export function canProcessTenders(
  user:
    | {
        role?: string | null;
        can_process_tenders?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (!user) return false;
  if ((user.role || '').toLowerCase() === 'admin') return true;
  return user.can_process_tenders === true;
}

/** Алиас: историческое имя для спроса. */
export const canProcessDemand = canProcessTenders;
