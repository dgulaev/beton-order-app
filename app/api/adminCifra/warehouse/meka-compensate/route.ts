// Ручной дозапуск компенсации MEKA−склад за дату (если upload был до хука).
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { compensateMekaCementDelta } from '@/lib/mekaCementCompensate';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const reportDate = String(body?.date || '').substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return NextResponse.json({ error: 'Нужен date=YYYY-MM-DD' }, { status: 400 });
    }

    const { data: report, error } = await supabase
      .from('meka_reports')
      .select('id, raw_data, total_cement')
      .eq('report_date', reportDate)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!report) {
      return NextResponse.json({ error: 'Отчёт MEKA за эту дату не найден' }, { status: 404 });
    }

    const result = await compensateMekaCementDelta({
      reportDate,
      mekaReportId: Number(report.id),
      rawData: report.raw_data,
      userName: auth.user.full_name || 'Админ',
    });

    return NextResponse.json({
      success: result.ok,
      ...result,
    });
  } catch (err: any) {
    console.error('meka-compensate POST:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
