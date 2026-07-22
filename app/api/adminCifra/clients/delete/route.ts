import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
    if (auth.error) return auth.error;

    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const parsedId = parseInt(userId, 10);
    if (!Number.isFinite(parsedId)) {
      return NextResponse.json({ error: 'Некорректный userId' }, { status: 400 });
    }

    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('user_id', parsedId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 });
    }
    if (target.role !== 'client') {
      return NextResponse.json({ error: 'Можно удалять только клиентов' }, { status: 400 });
    }

    const { count, error: countError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', parsedId);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Нельзя удалить клиента, у которого есть заказы' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('user_id', parsedId)
      .eq('role', 'client');

    if (error) {
      console.error('Ошибка удаления:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Клиент удалён' });
  } catch (error: any) {
    console.error('Delete client error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
