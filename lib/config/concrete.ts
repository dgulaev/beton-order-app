// lib/config/concrete.ts
// Центральный конфиг для Мини-приложения Max и АдминЦифра

export const CONCRETE_CONFIG = {
  // ==================== ЦЕНЫ НА БЕТОН ====================
  prices: {
    'М100': 6380,
    'М150': 6500,
    'М200': 6600,
    'М250': 6950,
    'М300': 7230,   // марка по умолчанию
    'М350': 7400,
    'М400': 8050,
    'М450': 8350,
    'М500': 8700,
  } as const,

  // ==================== ДОСТАВКА ====================
  delivery: {
    baseCostUpTo10: 6000,           // до 10 м³
    cost12m3: 7500,                 // 10–12 м³
    costPer10m3: 6000,              // за каждые 10 м³ (свыше 12)
    costPerM3Over50: 600,           // свыше 50 м³ — за м³
  },

  // ==================== ПРОИЗВОДИТЕЛЬНОСТЬ ЗАВОДА ====================
  /** Минут на 1 м³ погрузки/отгрузки */
  MINUTES_PER_CUBIC_METER: 1,       // ← Изменяй здесь (было 2, сейчас 1)

  // ==================== РЕФЕРАЛЬНАЯ СИСТЕМА ====================
  referral: {
    bonusPerCubicMeter: 100,        // баллов (рублей) за 1 м³
    defaultBalance: 0,
  },

  // ==================== РОЛИ ПОЛЬЗОВАТЕЛЕЙ ====================
  roles: {
    CLIENT: 'client',
    MANAGER: 'manager',
    DISPATCHER: 'dispatcher',
    ADMIN: 'admin',
  } as const,

  // ==================== ДРУГИЕ НАСТРОЙКИ ====================
  defaults: {
    defaultGrade: 'М300' as const,
    defaultDeliveryTime: '10:00',
  },

  // ==================== ЛИМИТЫ И ВАЛИДАЦИЯ ====================
  limits: {
    minVolume: 0.5,
    maxVolume: 100,
    minAddressLength: 5,
    minFullNameLength: 5,
    minOrganizationNameLength: 3,
  },
} as const;

// Удобные типы
export type ConcreteGrade = keyof typeof CONCRETE_CONFIG.prices;
export type UserRole = typeof CONCRETE_CONFIG.roles[keyof typeof CONCRETE_CONFIG.roles];