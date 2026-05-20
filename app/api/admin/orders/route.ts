// app/api/admin/orders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');

    if (!userIdParam) {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const currentUserId = parseInt(userIdParam, 10);
    if (isNaN(currentUserId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId format' }, { status: 400 });
    }

    // Используем Service Role Key — полностью обходит RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Проверяем роль пользователя
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', currentUserId)
      .single();

    // ←←← Добавили 'operator'
    const allowedRoles = ['admin', 'manager', 'dispatcher', 'operator'];
    const isStaff = user?.role && allowedRoles.includes(user.role);

    if (!isStaff) {
      console.warn(`⛔ Доступ запрещён. Роль: ${user?.role || 'unknown'}`);
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 });
    }

    console.log(`✅ ${user?.role} (${currentUserId}) получил доступ к списку заказов`);

    // Загружаем ВСЕ заказы
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      orders: orders || [] 
    });

  } catch (error: any) {
    console.error('Server error in /api/admin/orders:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}