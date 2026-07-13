// app/mobile/driver/driverClient.ts
// Общие хелперы для кабинета водителя: хранение сессии и запросы с
// авторизационными заголовками (номер миксера + телефон проверяются на
// сервере при каждом запросе, см. lib/driverAuth.ts).

const STORAGE_KEYS = {
  number: 'driver_mixer_number',
  phone: 'driver_phone',
} as const;

export interface DriverSession {
  number: string;
  phone: string;
}

export function getStoredDriverSession(): DriverSession | null {
  if (typeof window === 'undefined') return null;
  const number = localStorage.getItem(STORAGE_KEYS.number);
  const phone = localStorage.getItem(STORAGE_KEYS.phone);
  if (!number || !phone) return null;
  return { number, phone };
}

export function storeDriverSession(session: DriverSession) {
  localStorage.setItem(STORAGE_KEYS.number, session.number);
  localStorage.setItem(STORAGE_KEYS.phone, session.phone);
}

export function clearDriverSession() {
  localStorage.removeItem(STORAGE_KEYS.number);
  localStorage.removeItem(STORAGE_KEYS.phone);
}

export async function driverFetch(url: string, options: RequestInit = {}) {
  const session = getStoredDriverSession();
  const headers = new Headers(options.headers || {});
  if (session) {
    // HTTP-заголовки допускают только ISO-8859-1 — номер миксера может содержать
    // кириллицу, поэтому кодируем перед записью (см. decodeURIComponent в lib/driverAuth.ts).
    headers.set('x-driver-mixer-number', encodeURIComponent(session.number));
    headers.set('x-driver-phone', encodeURIComponent(session.phone));
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers, cache: 'no-store' });
}

export interface DriverMixerInfo {
  id: number;
  number: string;
  model: string | null;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
}

export interface DriverTrip {
  id: number;
  orderId: number;
  mixerName: string;
  time: string;
  volume: number;
  status: string;
  createdAt: string;
  onSiteAt: string | null;
  unloadedAt: string | null;
  downtimeMinutes: number | null;
  order: {
    id: number;
    deliveryDate: string;
    deliveryTime: string;
    address: string;
    grade: string;
    clientName: string;
    phone: string;
    comment: string | null;
    status: string;
  } | null;
}
