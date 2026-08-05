import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export const ADMIN_CIFRA_STAFF_ROLES = [
  'admin',
  'manager',
  'dispatcher',
  'operator',
  'laborant',
  'mehanik',
  'guest',
] as const;

export type AdminCifraStaffRole = (typeof ADMIN_CIFRA_STAFF_ROLES)[number];

export type AdminCifraUser = {
  user_id: number;
  role: string;
  full_name: string | null;
  can_process_tenders: boolean;
};

type AuthOk = { user: AdminCifraUser; error?: undefined };
type AuthFail = { user?: undefined; error: NextResponse };

/** Guard по заголовку x-user-id + роли в users (как в mixer-trips / user/role). */
export async function requireAdminCifraStaff(
  request: NextRequest,
  allowedRoles: readonly string[] = ADMIN_CIFRA_STAFF_ROLES
): Promise<AuthOk | AuthFail> {
  const raw = request.headers.get('x-user-id');
  const userId = raw ? parseInt(raw, 10) : NaN;

  if (!Number.isFinite(userId) || userId <= 0) {
    return {
      error: NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 }),
    };
  }

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('user_id, role, full_name, force_logout_version, can_process_tenders')
    .eq('user_id', userId)
    .maybeSingle();

  // Таймаут/сеть Supabase ≠ «нет прав» — иначе маскируем 403 и ломаем heartbeat/план.
  if (userErr) {
    console.error('[adminCifraAuth] users lookup failed:', userErr.message || userErr);
    return {
      error: NextResponse.json(
        { error: 'Сервис временно недоступен', code: 'auth_upstream' },
        { status: 503 },
      ),
    };
  }

  const role = (user?.role || '').toLowerCase();
  // Любая ненулевая версия = сессия принудительно завершена (логин сбрасывает в 0)
  const forcedOut = Number(user?.force_logout_version || 0) > 0;
  if (
    !user
    || !allowedRoles.map((r) => r.toLowerCase()).includes(role)
    || forcedOut
  ) {
    return {
      error: NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 }),
    };
  }

  return {
    user: {
      user_id: user.user_id,
      role,
      full_name: user.full_name ?? null,
      can_process_tenders: user.can_process_tenders === true,
    },
  };
}

export const ADMIN_MUTATION_ROLES = ['admin', 'manager'] as const;

/** Добавление / правка / удаление единиц парка (Техника). Без guest. */
export const FLEET_MUTATION_ROLES = [
  'admin',
  'manager',
  'dispatcher',
  'operator',
  'laborant',
  'mehanik',
] as const;

/** Мутации склада / заявок: без guest и laborant. */
export const WAREHOUSE_MUTATION_ROLES = [
  'admin',
  'manager',
  'dispatcher',
  'operator',
] as const;

export const ORDER_MUTATION_ROLES = WAREHOUSE_MUTATION_ROLES;

/** Публикация / сброс общего плана интеллекта (Фаза 6). Оператор только читает. */
export const PLANNER_EDIT_ROLES = ['admin', 'manager', 'dispatcher'] as const;

/** Реэкспорт для API-роутов (источник — клиентский модуль без server deps). */
export {
  SALES_ROLES,
  isSalesPath,
  canAccessSales,
} from '@/lib/adminCifraSalesAccess';

/** Удаление «лёгкого» рейса (ещё без списания) — те же роли, что и заявки. */
export const ORDER_MIXER_DELETE_ROLES = WAREHOUSE_MUTATION_ROLES;
