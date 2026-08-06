/** Сводный снимок всего, что СКАУТ отдаёт по ТС за период. */

import { scoutFetchFuelingStats } from './fuel';
import {
  scoutFetchLatestOdometerKmWithFallback,
  scoutFetchPeriodMileageKm,
} from './odometer';
import { scoutFetchMotorModes } from './motorModes';
import { scoutFetchTrackPeriods } from './trackPeriods';
import { scoutFetchAnalogSensors } from './analogSensors';
import type { DrumDriveType } from '@/lib/fleetDrumDrive';
import {
  guessMixerDrumHours,
  scoutFetchDiscreteSensors,
  scoutFetchDiscreteSensorsWithFallback,
  type ScoutDiscreteStats,
  type ScoutDiscreteStatsWindow,
} from './discreteSensors';
import type { ScoutServiceAvailability, ScoutUnitOverview } from './overviewTypes';

function isDiscreteWindow(
  d: ScoutDiscreteStats | ScoutDiscreteStatsWindow,
): d is ScoutDiscreteStatsWindow {
  return 'windowDays' in d && typeof (d as ScoutDiscreteStatsWindow).windowDays === 'number';
}

export type { ScoutServiceAvailability, ScoutUnitOverview } from './overviewTypes';

async function settle<T>(
  label: string,
  fn: () => Promise<T>,
  availability: ScoutServiceAvailability[],
): Promise<T | null> {
  try {
    const v = await fn();
    availability.push({ service: label, ok: true });
    return v;
  } catch (e) {
    availability.push({
      service: label,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function scoutFetchUnitOverview(opts: {
  unitId: number;
  fromYmd: string;
  toYmd: string;
  /** Только для миксеров считаем моточасы бочки */
  isMixer?: boolean;
  /** ВОМ или отдельный ДВС на бочке */
  drumDriveType?: DrumDriveType;
  /** Явный индекс дискрета бочки из specs */
  drumSensorIndex?: number | null;
}): Promise<ScoutUnitOverview> {
  const fromIso = `${opts.fromYmd}T00:00:00+03:00`;
  const toIso = `${opts.toYmd}T23:59:59.999+03:00`;
  const availability: ScoutServiceAvailability[] = [];

  // Последовательно — сервер СКАУТ часто рвёт параллельные сессии (ECONNRESET)
  const fuel = await settle('fdstat', () => scoutFetchFuelingStats({
    unitId: opts.unitId,
    fromIso,
    toIso,
  }), availability);

  const odometer = await settle(
    'Odometer',
    () => scoutFetchLatestOdometerKmWithFallback({ unitId: opts.unitId }),
    availability,
  );

  const periodMileage = await settle(
    'trackPeriodsMileage',
    () =>
      scoutFetchPeriodMileageKm({
        unitId: opts.unitId,
        fromYmd: opts.fromYmd,
        toYmd: opts.toYmd,
      }),
    availability,
  );

  const motorModes = await settle(
    'MotorModes',
    () =>
      scoutFetchMotorModes({
        unitId: opts.unitId,
        fromIso,
        toIso,
      }),
    availability,
  );

  let discreteRaw: ScoutDiscreteStats | ScoutDiscreteStatsWindow | null = await settle(
    'DiscreteSensor',
    () =>
      scoutFetchDiscreteSensors({
        unitId: opts.unitId,
        fromIso,
        toIso,
      }),
    availability,
  );

  // Длинный период (YTD) часто без Points — для бочки берём 7→30→90 сут.
  const discreteHasPoints = discreteRaw?.sensors.some((s) => s.pointsCount > 0);
  if (opts.isMixer && !discreteHasPoints) {
    const fb = await settle(
      'DiscreteSensor',
      () =>
        scoutFetchDiscreteSensorsWithFallback({
          unitId: opts.unitId,
          toYmd: opts.toYmd,
        }),
      availability,
    );
    if (fb) discreteRaw = fb;
  }

  const trackPeriods = await settle(
    'TrackPeriod',
    () =>
      scoutFetchTrackPeriods({
        unitId: opts.unitId,
        fromIso,
        toIso,
        periodsLimit: 40,
      }),
    availability,
  );

  const analog = await settle(
    'AnalogSensor',
    () =>
      scoutFetchAnalogSensors({
        unitId: opts.unitId,
        fromIso: `${opts.toYmd}T00:00:00+03:00`,
        toIso,
      }),
    availability,
  );

  const discrete = discreteRaw
    ? {
        sensors: discreteRaw.sensors.map((s) => ({
          index: s.index,
          name: s.name,
          pointsCount: s.pointsCount,
          onHours: s.onHours,
          lastValue: s.lastValue,
        })),
      }
    : null;

  let drumHours: ScoutUnitOverview['drumHours'] = null;
  if (opts.isMixer) {
    const driveType: DrumDriveType = opts.drumDriveType ?? 'pto';
    if (discreteRaw) {
      let engOn = motorModes?.engineOnHours ?? null;
      const window = isDiscreteWindow(discreteRaw) ? discreteRaw : null;
      // если дискрет из fallback-окна — якорь MotorModes за то же окно
      if (window && window.fromIso !== fromIso) {
        const mmFb = await settle(
          'MotorModes',
          () =>
            scoutFetchMotorModes({
              unitId: opts.unitId,
              fromIso: window.fromIso,
              toIso: window.toIso,
            }),
          availability,
        );
        if (mmFb) engOn = mmFb.engineOnHours;
      }
      drumHours = guessMixerDrumHours({
        sensors: discreteRaw.sensors,
        engineOnHours: engOn,
        driveType,
        preferredSensorIndex: opts.drumSensorIndex,
      });
      if (
        drumHours.drumOnHours != null &&
        window &&
        window.fromYmd !== opts.fromYmd
      ) {
        drumHours = {
          ...drumHours,
          note: `за ${window.fromYmd} — ${window.toYmd}`,
        };
      }
    } else {
      drumHours = {
        driveType,
        drumOnHours: null,
        sensorIndex: null,
        ignitionOnHours: null,
        ignitionSensorIndex: null,
        confidence: 'none',
        note: 'нет данных за период',
      };
    }
  }

  return {
    unitId: opts.unitId,
    fromYmd: opts.fromYmd,
    toYmd: opts.toYmd,
    fuel,
    odometer,
    periodMileage,
    motorModes,
    discrete,
    drumHours,
    trackPeriods,
    analog,
    availability,
    unavailableOnServer: [],
  };
}
