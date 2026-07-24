/** Три силоса БСУ: ёмкости в тоннах. */
export const SILO_SPEC = [
  { silo_id: 1, name: 'Силос 1', max: 85 },
  { silo_id: 2, name: 'Силос 2', max: 85 },
  { silo_id: 3, name: 'Силос 3', max: 170 },
] as const;

export type SiloSpecId = (typeof SILO_SPEC)[number]['silo_id'];

export function siloNameById(siloId: number | null | undefined): string {
  const spec = SILO_SPEC.find((s) => s.silo_id === Number(siloId));
  return spec?.name || (siloId ? `Силос №${siloId}` : 'Силос');
}
