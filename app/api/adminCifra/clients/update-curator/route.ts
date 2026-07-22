import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
    if (auth.error) return auth.error;

    const { client_ids, new_curator_id } = await request.json();

    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return NextResponse.json({ error: 'client_ids обязателен (массив)' }, { status: 400 });
    }
    if (!new_curator_id) {
      return NextResponse.json({ error: 'new_curator_id обязателен' }, { status: 400 });
    }

    const curatorId = Number(new_curator_id);
    if (!Number.isFinite(curatorId)) {
      return NextResponse.json({ error: 'Некорректный new_curator_id' }, { status: 400 });
    }

    const { data: curator, error: curatorError } = await supabase
      .from('users')
      .select('user_id, full_name, role')
      .eq('user_id', curatorId)
      .maybeSingle();

    if (curatorError) {
      return NextResponse.json({ error: curatorError.message }, { status: 500 });
    }
    if (!curator || curator.role === 'client') {
      return NextResponse.json({ error: 'Куратор должен быть сотрудником' }, { status: 400 });
    }

    const ids = client_ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isFinite(id));
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Нет корректных client_ids' }, { status: 400 });
    }

    const updateData = {
      curator_id: curatorId,
      curator_name: curator.full_name || null,
      created_by: curatorId,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await supabase
      .from('users')
      .update(updateData)
      .in('user_id', ids)
      .eq('role', 'client')
      .select('user_id');

    if (error) {
      console.error('Update curator error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const count = updated?.length ?? 0;

    return NextResponse.json({
      success: true,
      updated: count,
      message: `Куратор назначен ${count} клиентам`,
    });
  } catch (error: any) {
    console.error('Update curator API error:', error);
    return NextResponse.json({ error: error.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}
