import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type');
    const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true';

    let query = supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (unreadOnly) query = query.eq('is_read', false);

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      notifications: data || []
    });

  } catch (error: any) {
    console.error('❌ Notifications API error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message 
    }, { status: 500 });
  }
}