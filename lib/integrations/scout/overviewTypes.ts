/** Типы обзора СКАУТ — без server-only импортов (можно на клиенте). */

export type ScoutServiceAvailability = {
  service: string;
  ok: boolean;
  error?: string;
};

export type ScoutUnitOverview = {
  unitId: number;
  fromYmd: string;
  toYmd: string;
  fuel: {
    beginFuelVolumeL: number | null;
    endFuelVolumeL: number | null;
    fuelingTotalVolumeL: number | null;
    defuelingTotalVolumeL: number | null;
    totalFuelConsumptionL: number | null;
    fuelingCount: number;
    defuelingCount: number;
  } | null;
  odometer: {
    mileageKm: number | null;
    error: string | null;
    dayYmd: string;
    atIso: string | null;
    source?: 'odometer' | 'analog_nav';
    sensorName?: string | null;
  } | null;
  periodMileage: {
    totalMileageKm: number | null;
    movementMileageKm: number | null;
    fromYmd: string;
    toYmd: string;
  } | null;
  motorModes: {
    engineOnHours: number | null;
    engineOffHours: number | null;
    engineActiveWorkHours: number | null;
    engineIdleHours: number | null;
    periodsCount: number;
  } | null;
  /** Дискретные каналы (зажигание, бочка и т.п.) */
  discrete: {
    sensors: Array<{
      index: number;
      name: string | null;
      pointsCount: number;
      onHours: number;
      lastValue: boolean | null;
    }>;
  } | null;
  /**
   * Моточасы смесителя на бочке — только для vehicle_kind=mixer.
   * Считаются по DiscreteSensor (не MotorModes).
   * driveType: pto | separate_engine.
   */
  drumHours: {
    driveType: 'pto' | 'separate_engine';
    drumOnHours: number | null;
    sensorIndex: number | null;
    ignitionOnHours: number | null;
    ignitionSensorIndex: number | null;
    confidence: 'high' | 'low' | 'none';
    note: string | null;
  } | null;
  trackPeriods: {
    movementCount: number;
    parkingCount: number;
    idleCount: number;
    breakCount: number;
    otherCount: number;
  } | null;
  analog: {
    fuelLevelL: number | null;
    sensors: Array<{
      name: string;
      number: number;
      pointsCount: number;
      lastValue: number | null;
      lastAtIso: string | null;
      kind: 'fuel' | 'voltage' | 'temp' | 'odometer_like' | 'other';
    }>;
  } | null;
  availability: ScoutServiceAvailability[];
  unavailableOnServer: string[];
};
