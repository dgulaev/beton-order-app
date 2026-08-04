// app/api/geocode/route.ts
// Геокодирование адреса в координаты через DaData (для построения маршрутов
// в Яндекс.Картах). Ключ держим только на сервере.
import { NextRequest, NextResponse } from 'next/server';
import { isPickupOrder, normalizeDeliveryAddress } from '@/lib/bryanskAddress';
import {
  extractCoordsFromAddress,
  geocodeAddressWithFallback,
  getRouteOriginCoords,
} from '@/lib/geocodeAddress';

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    const raw = (address || '').trim();

    if (!raw) {
      return NextResponse.json({ lat: null, lon: null });
    }

    // Самовывоз → координаты завода, не центр Брянска.
    if (isPickupOrder(raw)) {
      return NextResponse.json(getRouteOriginCoords());
    }

    // Уже нормализованные вызовы (UI) не ломаем; сырой «д. Заречная» → область.
    // Landmark («ЖК Рай») может подставить lat/lon — тогда DaData не нужен.
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
