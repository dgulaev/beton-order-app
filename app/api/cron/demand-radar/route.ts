import { NextRequest, NextResponse } from 'next/server';
import { runDemandRadar } from '@/lib/demand/demandService';
import { requireCronAuth } from '@/lib/cronAuth';

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await runDemandRadar();
    return NextResponse.json({ success: result.errors.length === 0, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
