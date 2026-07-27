/**
 * Клиентский/общий доступ к разделу «Продажи».
 * Без server-only импортов — можно использовать в layout.tsx.
 */

export const SALES_ROLES = ['admin', 'manager', 'dispatcher'] as const;

export function isSalesPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith('/adminCifra/leads') ||
    pathname.startsWith('/adminCifra/marketplace') ||
    pathname.startsWith('/adminCifra/demand') ||
    pathname.startsWith('/adminCifra/integrations')
  );
}

export function canAccessSales(role: string | null | undefined): boolean {
  if (!role) return false;
  return (SALES_ROLES as readonly string[]).includes(role.toLowerCase());
}
