import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { toStoredPhone } from '@/lib/phone';

const ALLOWED_FIELDS = [
  'full_name',
  'organization_name',
  'phone',
  'inn',
  'address',
  'client_status',
  'loyalty_score',
  'last_contact',
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId обязателен' }, { status: 400 });
    }

    const targetId = typeof userId === 'string' ? parseInt(userId, 10) : Number(userId);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: 'Некорректный userId' }, { status: 400 });
    }

    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('user_id', targetId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!target || target.role !== 'client') {
      return NextResponse.json({ error: 'Можно обновлять только клиентов' }, { status: 400 });
    }

    const updatePayload: Partial<Record<AllowedField, unknown>> = {};
    for (const key of ALLOWED_FIELDS) {
      if (body[key] !== undefined) {
        updatePayload[key] = body[key] === '' ? null : body[key];
      }
    }

    if (updatePayload.phone !== undefined) {
      if (updatePayload.phone === null) {
        // ok — очистка телефона
      } else {
        const stored = toStoredPhone(String(updatePayload.phone));
        if (!stored) {
          return NextResponse.json(
            { error: 'Некорректный телефон (нужен полный номер РФ)' },
            { status: 400 }
          );
        }
        updatePayload.phone = stored;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'Нет данных для обновления' }, { status: 400 });
    }

    const { error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('user_id', targetId)
      .eq('role', 'client');

    if (error) {
      console.error('❌ Supabase Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Клиент успешно обновлён',
    });
  } catch (error: any) {
    console.error('❌ Update client error:', error);
    return NextResponse.json({ error: error.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}
