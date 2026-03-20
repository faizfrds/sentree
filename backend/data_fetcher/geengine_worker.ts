import axios from 'axios';

const GIBS_WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

// 10 samples per day at 30-minute intervals → 30 images total across T0/T-30/T-60
const SAMPLES_PER_DAY = 10;
const INTERVAL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Satellite selection
// ---------------------------------------------------------------------------
// Coverage zones are defined by each satellite's sub-satellite longitude point
// (±~70° usable field of view). Verify layer names at:
// https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities
//
//  Satellite    Sub-lon   GIBS coverage (approx)
//  GOES-East    −75.2°    −145° to −5°   (Americas)
//  GOES-West   −137.2°    145° to −135°  (Far Pacific / Hawaii)
//  Himawari-9   140.7°     70° to 160°   (Asia-Pacific)
//  MODIS-Terra  (polar)   global          (daily, fallback for Europe/Africa)
// ---------------------------------------------------------------------------

interface SatelliteConfig {
  name: string;
  layer: string;
  /** true = supports ISO 8601 datetime in TIME param (intraday cadence ~10 min) */
  subDaily: boolean;
}

/**
 * Returns the best available satellite/layer for the given longitude.
 * Sub-daily geostationary satellites are preferred; MODIS is used as a
 * daily fallback for Europe, Africa, and the Middle East where no
 * geostationary source is currently indexed in NASA GIBS.
 */
export function selectSatellite(lng: number): SatelliteConfig {
  // Normalize to [-180, 180]
  const norm = ((lng + 180) % 360 + 360) % 360 - 180;

  if (norm >= -145 && norm < -5) {
    // Americas — GOES-East
    return {
      name: 'GOES-East',
      layer: 'GOES-East_ABI_Band2_Red_Visible_1km',
      subDaily: true,
    };
  }

  if (norm >= 70 && norm <= 160) {
    // Asia-Pacific (incl. Sumatra, Australia, Japan) — Himawari-9
    return {
      name: 'Himawari-9',
      layer: 'Himawari_AHI_Band3_Red_Visible_1km',
      subDaily: true,
    };
  }

  if (norm > 160 || norm < -145) {
    // Far Pacific / Hawaii — GOES-West
    return {
      name: 'GOES-West',
      layer: 'GOES-West_ABI_Band2_Red_Visible_1km',
      subDaily: true,
    };
  }

  // -5° to 70°: Europe, Africa, Middle East — no sub-daily source in GIBS;
  // fall back to MODIS Terra (one composite per day, cloud-free best-effort).
  return {
    name: 'MODIS-Terra',
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    subDaily: false,
  };
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SatelliteImage {
  label: string;
  date: string;      // YYYY-MM-DD
  time: string;      // ISO 8601 datetime (sub-daily) or YYYY-MM-DD (MODIS fallback)
  imageBase64: string;
}

export interface DayBundle {
  label: string;            // 'T0', 'T-30', 'T-60'
  date: string;             // YYYY-MM-DD
  satellite: string;        // human-readable satellite name, for logging/debugging
  images: SatelliteImage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function subtractDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Computes the UTC hour of solar noon for a given longitude.
 * Solar noon shifts by 1 hour per 15° of longitude.
 * e.g. lng=100°E → solar noon at ~05:20 UTC; lng=-75° → ~17:00 UTC.
 */
function solarNoonUTC(lng: number): number {
  return ((12 - lng / 15) % 24 + 24) % 24;
}

/**
 * Builds SAMPLES_PER_DAY ISO 8601 timestamps at INTERVAL_MINUTES spacing,
 * centered on the local solar noon (converted to UTC) for the given longitude.
 * This ensures all samples fall within the daytime window regardless of timezone.
 *
 * Example — Sumatra (lng ≈ 100°E):
 *   solar noon UTC ≈ 05:20 → window 02:50–07:20 UTC = 09:50–14:20 local (UTC+7) ✓
 *
 * Example — Amazon (lng ≈ -60°):
 *   solar noon UTC ≈ 16:00 → window 13:30–18:00 UTC = 10:30–15:00 local (UTC-3) ✓
 */
function buildDaytimeTimestamps(date: Date, lng: number): string[] {
  const noonUTC = solarNoonUTC(lng);
  const windowMinutes = SAMPLES_PER_DAY * INTERVAL_MINUTES; // total span = 5 hours
  const startMinutesUTC = noonUTC * 60 - windowMinutes / 2;

  const timestamps: string[] = [];
  for (let i = 0; i < SAMPLES_PER_DAY; i++) {
    const t = new Date(date);
    const totalMinutes = startMinutesUTC + i * INTERVAL_MINUTES;
    // Handle wrap-around midnight (totalMinutes may be negative or > 1440)
    const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    t.setUTCHours(Math.floor(normalizedMinutes / 60), normalizedMinutes % 60, 0, 0);
    timestamps.push(t.toISOString().replace('.000Z', 'Z'));
  }
  return timestamps;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches a time-series of satellite images for the given coordinates across
 * three day snapshots (T0, T-30, T-60).
 *
 * Sub-daily satellites (GOES-East, GOES-West, Himawari-9):
 *   10 images per day at 30-min intervals (12:00–16:30 UTC) → 30 images total.
 *   Averaging detections across the intraday samples reduces cloud-cover bias.
 *
 * MODIS fallback (Europe/Africa/Middle East):
 *   1 daily composite per day → 3 images total (no intraday averaging).
 *
 * @param coords    - { lat, lng }
 * @param delta     - Half-extent in degrees around the point (default 0.25° ≈ 25 km radius)
 * @param imageSize - Pixel dimensions for each fetched image (default 512)
 */
export async function fetchTimeseriesImages(
  coords: { lat: number; lng: number },
  delta = 0.25,
  imageSize = 512
): Promise<DayBundle[]> {
  const { lat, lng } = coords;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const satellite = selectSatellite(lng);

  const today = new Date();
  const days = [
    { label: 'T0',   date: today },
    { label: 'T-30', date: subtractDays(today, 30) },
    { label: 'T-60', date: subtractDays(today, 60) },
  ];

  const sampleCount = satellite.subDaily ? SAMPLES_PER_DAY : 1;
  console.log(
    `[GEE] Satellite: ${satellite.name} | ` +
    `${days.length} days × ${sampleCount} samples | coords: ${JSON.stringify(coords)}`
  );

  const bundles = await Promise.all(
    days.map(async ({ label, date }) => {
      const dateStr = formatDate(date);

      // Sub-daily: 10 intraday timestamps. MODIS fallback: single date string.
      const timeTokens: string[] = satellite.subDaily
        ? buildDaytimeTimestamps(date, lng)
        : [dateStr];

      const images = await Promise.all(
        timeTokens.map(async (timeToken) => {
          const url =
            `${GIBS_WMS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
            `&LAYERS=${satellite.layer}&CRS=CRS:84` +
            `&BBOX=${bbox}&WIDTH=${imageSize}&HEIGHT=${imageSize}` +
            `&FORMAT=image/jpeg&TIME=${timeToken}`;

          const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });

          // Guard: GIBS returns XML (not JPEG) when a layer name or TIME value is
          // invalid. Forwarding XML to Roboflow causes a silent 400. Catch it here.
          const contentType: string = response.headers['content-type'] ?? '';
          if (contentType.includes('xml') || contentType.includes('text')) {
            const body = Buffer.from(response.data).toString('utf8');
            throw new Error(
              `[GEE] GIBS returned non-image response for layer "${satellite.layer}" ` +
              `at TIME=${timeToken}: ${body.slice(0, 300)}`
            );
          }

          const imageBase64 = Buffer.from(response.data).toString('base64');
          return { label, date: dateStr, time: timeToken, imageBase64 };
        })
      );

      console.log(
        `[GEE] ${label} (${dateStr}): fetched ${images.length} image(s) via ${satellite.name}`
      );
      return { label, date: dateStr, satellite: satellite.name, images };
    })
  );

  return bundles;
}
