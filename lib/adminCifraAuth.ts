import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export const ADMIN_CIFRA_STAFF_ROLES = [
  'admin',
  'manager',
  'dispatcher',
  'operator',
  'laborant',
  'guest',
] as const;

export type AdminCifraStaffRole = (typeof ADMIN_CIFRA_STAFF_ROLES)[number];

export type AdminCifraUser = {
  user_id: number;
  role: string;
  full_name: string | null;
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

  const { data: user } = await supabase
    .from('users')
    .select('user_id, role, full_name, force_logout_version')
    .eq('user_id', userId)
    .maybeSingle();

  const role = (user?.role || '').toLowerCase();
  if (
    !user ||
    !allowedRoles.map((r) => r.toLowerCase()).includes(role) ||
    (user.force_logout_version != null && user.force_logout_version >= 9999)
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
    },
  };
}

export const ADMIN_MUTATION_ROLES = ['admin', 'manager'] as const;
