/** Тип admin_notifications для глубокого минуса силоса (общий клиент/сервер). */
export const SILO_LOW_RATE_ADMIN_TYPE = 'silo_low_rate';

/** Стабильный тег эпизода в message — дедуп и «не слать повторно по этой проблеме». */
export function siloLowRateEpisodeTag(siloId: number, alertAt: string): string {
  return `[episode:${siloId}:${alertAt}]`;
}
