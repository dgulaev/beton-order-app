// app/api/geocode/route.ts
// Геокодирование адреса в координаты через DaData (для построения маршрутов
// в Яндекс.Картах). Ключ держим только на сервере.
import { NextRequest, NextResponse } from 'next/server';
import { normalizeDeliveryAddress } from '@/lib/bryanskAddress';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
} from '@/lib/geocodeAddress';

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    const raw = (address || '').trim();

    if (!raw || !process.env.DADATA_API_KEY) {
      return NextResponse.json({ lat: null, lon: null });
    }

    // Уже нормализованные вызовы (UI) не ломаем; сырой «д. Заречная» → область.
    const query = extractCoordsFromAddress(raw)
      ? raw
      : normalizeDeliveryAddress(raw);

    const coords = await geocodeAddressWithFallback(query);
    if (!coords) {
      return NextResponse.json({ lat: null, lon: null });
    }

    return NextResponse.json(coords);
  } catch (err) {
    console.error('Ошибка геокодирования адреса:', err);
    return NextResponse.json({ lat: null, lon: null });
  }
}
