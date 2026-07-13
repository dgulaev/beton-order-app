// lib/driverAuth.ts
// Проверка личности водителя по паре "номер миксера + телефон". Никакого
// отдельного пароля/токена нет — сессия хранится на клиенте (localStorage),
// но КАЖДЫЙ запрос к API водителя повторно проверяется здесь по живым данным
// из mixers. Поэтому если диспетчер поменял телефон в админке, старая пара
// номер+телефон сразу перестаёт проходить проверку — без дополнительной логики.
import { NextRequest } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { phonesMatch } from '@/lib/phone';

export interface DriverMixer {
  id: number;
  number: string;
  model: string | null;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  status: string;
  unload_allowance_min: number | null;
}

export async function verifyDriver(number: string, phone: string): Promise<DriverMixer | null> {
  if (!number || !phone) return null;

  const { data, error } = await supabase
    .from('mixers')
    .select('id, number, model, driver, phone, volume, type, status, unload_allowance_min')
    .eq('number', number.trim())
    .maybeSingle();

  if (error || !data) return null;
  if (!phonesMatch(data.phone, phone)) return null;

  return data as DriverMixer;
}

/** Извлекает и проверяет учётные данные водителя из заголовков запроса. Возвращает null, если доступ запрещён. */
export async function requireDriver(request: NextRequest): Promise<DriverMixer | null> {
  // Значения закодированы на клиенте через encodeURIComponent (см. driverFetch в
  // app/mobile/driver/driverClient.ts) — заголовки HTTP не поддерживают кириллицу как есть.
  const rawNumber = request.headers.get('x-driver-mixer-number');
  const rawPhone = request.headers.get('x-driver-phone');
  if (!rawNumber || !rawPhone) return null;

  try {
    const number = decodeURIComponent(rawNumber);
    const phone = decodeURIComponent(rawPhone);
    return verifyDriver(number, phone);
  } catch {
    return null;
  }
}
