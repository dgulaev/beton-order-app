// app/api/user/balance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        message: 'userId is required' 
      }, { status: 400 });
    }

    const parsedUserId = parseInt(userId, 10);

    const { data, error } = await supabase
      .from('users')
      .select('balance')
      .eq('user_id', parsedUserId)
      .single();

    if (error) {
      console.error('Balance fetch error:', error);
      // Если пользователя нет — возвращаем 0, а не ошибку
      return NextResponse.json({ 
        success: true, 
        balance: 0 
      });
    }

    return NextResponse.json({ 
      success: true, 
      balance: data?.balance || 0 
    });

  } catch (error: any) {
    console.error('Balance API error:', error);
    return NextResponse.json({ 
      success: true, 
      balance: 0 
    });
  }
}