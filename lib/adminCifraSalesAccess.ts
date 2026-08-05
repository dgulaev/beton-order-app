/**
 * Клиентский/общий доступ к разделу «Продажи».
 * Без server-only импортов — можно использовать в layout.tsx.
 */

import {
  canAccessNavSection,
  type SystemSettingsData,
} from '@/lib/systemSettings';

/** Исторический дефолт до матрицы (fallback, если roleAccess не передан). */
export const SALES_ROLES = ['admin', 'manager', 'dispatcher'] as const;

export function isSalesPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/adminCifra/leads') ||
    pathname.startsWith('/adminCifra/marketplace') ||
    pathname.startsWith('/adminCifra/demand') ||
    pathname.startsWith('/adminCifra/callout') ||
    pathname.startsWith('/adminCifra/integrations')
  );
}

/**
 * Доступ к «Продажам»: по матрице roleAccess.sales, если передана;
 * иначе — по SALES_ROLES (совместимость со старыми вызовами).
 */
export function canAccessSales(
  role: string | null | undefined,
  roleAccess?: SystemSettingsData['roleAccess'],
): boolean {
  if (!role) return false;
  if (roleAccess) {
    return canAccessNavSection(role, 'sales', roleAccess);
  }
  return (SALES_ROLES as readonly string[]).includes(role.toLowerCase());
}
