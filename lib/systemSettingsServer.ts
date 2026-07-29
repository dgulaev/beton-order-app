/**
 * Серверное чтение system_settings (service role) с fallback на дефолты.
 */
import { createClient } from '@supabase/supabase-js';
import { setRouteOriginAddressOverride } from '@/lib/bryanskAddress';
import { setRouteOriginCoordsOverride } from '@/lib/geocodeAddress';
import {
  DEFAULT_SYSTEM_SETTINGS,
  mergeSystemSettings,
  type SystemSettingsData,
} from '@/lib/systemSettings';

function applyPlantOverrides(settings: SystemSettingsData): void {
  setRouteOriginCoordsOverride({ lat: settings.plant.lat, lon: settings.plant.lon });
  setRouteOriginAddressOverride(settings.plant.address);
}

export async function loadSystemSettingsServer(): Promise<SystemSettingsData> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      applyPlantOverrides(DEFAULT_SYSTEM_SETTINGS);
      return DEFAULT_SYSTEM_SETTINGS;
    }

    const supabase = createClient(url, key);
    const { data, error } = await supabase
      .from('system_settings')
      .select('data')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data) {
      applyPlantOverrides(DEFAULT_SYSTEM_SETTINGS);
      return DEFAULT_SYSTEM_SETTINGS;
    }
    const merged = mergeSystemSettings(data.data);
    applyPlantOverrides(merged);
    return merged;
  } catch {
    applyPlantOverrides(DEFAULT_SYSTEM_SETTINGS);
    return DEFAULT_SYSTEM_SETTINGS;
  }
}
