// app/api/adminCifra/staff/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { phonesMatch, normalizePhone } from '@/lib/phone';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_STAFF_ROLES = ['admin', 'manager', 'dispatcher', 'operator', 'laborant', 'guest'];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request);
    if (auth.error) return auth.error;

    // Получаем всех сотрудников
    const { data: staffList, error } = await supabase
      .from('users')
      .select('user_id, full_name, username, phone, role, created_at, can_process_tenders')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator', 'logist'])
      .order('full_name');

    if (error) throw error;

    // Для каждого сотрудника считаем статистику
    const staffWithStats = await Promise.all(
      (staffList || []).map(async (staff: any) => {
        // Клиенты на кураторстве (как в /staff/stats и карточке стаффа)
        const { data: clients, error: clientsError } = await supabase
          .from('users')
          .select('user_id')
          .eq('curator_id', staff.user_id)
          .eq('role', 'client');

        if (clientsError) {
          console.error('Clients error for', staff.user_id, clientsError);
        }

        const clientIds = clients?.map((c) => c.user_id) || [];

        // Объём заказов по этим клиентам
        let totalVolume = 0;
        if (clientIds.length > 0) {
          const { data: orders } = await supabase
            .from('orders')
            .select('volume')
            .in('user_id', clientIds);

          totalVolume =
            orders?.reduce((sum: number, o: any) => sum + (Number(o.volume) || 0), 0) || 0;
        }

        return {
          ...staff,
          clients_count: clientIds.length,
          total_volume: totalVolume,
        };
      }),
    );

    return NextResponse.json(staffWithStats);
  } catch (error: any) {
    console.error('Staff API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ==================== СОЗДАНИЕ НОВОГО СОТРУДНИКА ====================
// Только admin: иначе менеджер мог бы выдать себе can_process_tenders / роль.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ['admin']);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { fullName, phone, role, password } = body;
    const canProcessTenders =
      body.canProcessTenders === true || body.can_process_tenders === true;

    if (!phone || !normalizePhone(phone)) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400 });
    }
    if (!role || !ALLOWED_STAFF_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Укажите корректную роль' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Пароль должен содержать минимум 6 символов' }, { status: 400 });
    }

    const { data: existingUsers } = await supabase
      .from('users')
      .select('user_id, phone')
      .not('phone', 'is', null);

    if ((existingUsers || []).some((u) => phonesMatch(u.phone, phone))) {
      return NextResponse.json({ error: 'Сотрудник с таким телефоном уже существует' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const normalizedPhone = '+' + normalizePhone(phone);
    const userId = Date.now();
    const referralCode = 'R' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data, error } = await supabase
      .from('users')
      .insert({
        user_id: userId,
        phone: normalizedPhone,
        full_name: fullName || null,
        role,
        password_hash: passwordHash,
        referral_code: referralCode,
        balance: 0,
        referred_by: null,
        can_process_tenders: canProcessTenders,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Создан новый сотрудник: ${data.user_id} (${normalizedPhone}, роль: ${role})`);

    return NextResponse.json({ success: true, user: data });
  } catch (error: any) {
    console.error('Create staff error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка сервера' }, { status: 500 });
  }
}

// ==================== РЕДАКТИРОВАНИЕ СОТРУДНИКА ====================
// Только admin: роль и can_process_tenders нельзя менять «сам себе» через UI/curl.
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ['admin']);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { userId, fullName, phone, role, password } = body;
    const hasTendersFlag =
      typeof body.canProcessTenders === 'boolean' ||
      typeof body.can_process_tenders === 'boolean';
    const canProcessTenders =
      body.canProcessTenders === true || body.can_process_tenders === true;

    if (!userId) {
      return NextResponse.json({ error: 'Не передан userId' }, { status: 400 });
    }
    if (!phone || !normalizePhone(phone)) {
      return NextResponse.json({ error: 'Укажите телефон' }, { status: 400 });
    }
    if (!role || !ALLOWED_STAFF_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Укажите корректную роль' }, { status: 400 });
    }

    // Телефон не должен совпадать с телефоном ДРУГОГО пользователя.
    const { data: existingUsers } = await supabase
      .from('users')
      .select('user_id, phone')
      .not('phone', 'is', null);

    if ((existingUsers || []).some((u) => u.user_id !== userId && phonesMatch(u.phone, phone))) {
      return NextResponse.json(
        { error: 'Этот телефон уже используется другим пользователем' },
        { status: 409 },
      );
    }

    const update: Record<string, any> = {
      full_name: fullName || null,
      phone: '+' + normalizePhone(phone),
      role,
      updated_at: new Date().toISOString(),
    };
    if (hasTendersFlag) {
      update.can_process_tenders = canProcessTenders;
    }

    if (password) {
      if (password.length < 6) {
        return NextResponse.json({ error: 'Пароль должен содержать минимум 6 символов' }, { status: 400 });
      }
      update.password_hash = await bcrypt.hash(password, 12);
    }

    const { data, error } = await supabase
      .from('users')
      .update(update)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Обновлён сотрудник: ${userId}`);

    return NextResponse.json({ success: true, user: data });
  } catch (error: any) {
    console.error('Update staff error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка сервера' }, { status: 500 });
  }
}
