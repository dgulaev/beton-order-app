// lib/mixerConfig.ts
// Константы миксеров, безопасные для импорта и на клиенте, и на сервере.

/** Норма разгрузки для СВОИХ миксеров (type = 'own'). Для наёмных — mixers.unload_allowance_min. */
export const OWN_UNLOAD_ALLOWANCE_MIN = 50;

export const ORDER_MIXER_STATUSES = ['Загрузка', 'В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'] as const;
export type OrderMixerStatus = (typeof ORDER_MIXER_STATUSES)[number];
