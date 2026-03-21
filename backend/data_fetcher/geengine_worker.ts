import axios from 'axios';

const GIBS_WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

// 10 samples per day at 30-minute intervals → 30 images total across T0/T-30/T-60
const SAMPLES_PER_DAY = 10;
const INTERVAL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Satellite selection
// ---------------------------------------------------------------------------
// Layer choices prioritise true-color RGB composites so that the YOLO model
// receives imagery that matches its training distribution and so the UI shows
// natural-looking color images.
//
// Why GeoColor over Band 2?
//   Band 2 (Red Visible) is a single spectral channel → grayscale output.
//   GeoColor is a true-color-like RGB composite produced by NOAA from multiple
//   ABI channels. It renders as a full-color image — far better for both
//   display and AI inference.
//
// Why MODIS True Color for Himawari / Europe / Africa?
//   GIBS has no Himawari true-color surface composite. The available Himawari
//   layers are either single-band visible (grayscale) or Air Mass RGB (a
//   false-color meteorological product that colors cloud types, not the
//   surface). MODIS Terra CorrectedReflectance True Color is a proper RGB
//   surface composite and produces imagery closest to what the YOLO
//   deforestation model was trained on.
//
// Coverage zones (satellite sub-longitude ± ~70° usable FOV):
//   GOES-East  −75.2°   −145° to −5°   (Americas)
//   GOES-West −137.2°    145° to −135°  (Far Pacific / Hawaii)
//   MODIS       polar    global          (daily; used for Asia-Pacific + Europe/Africa)
//
// Verify layer names at:
//   https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities
// ---------------------------------------------------------------------------

interface SatelliteConfig {
  name: string;
  layer: string;
  /** true = supports ISO 8601 datetime in TIME param (intraday cadence ~10 min) */
  subDaily: boolean;
  /**
   * Days to subtract from "today" before computing T0/T-30/T-60.
   * GOES GeoColor is near-real-time (0 days). MODIS CorrectedReflectance uses
   * higher-quality Level-2G processing which typically takes 1–2 days to appear
   * in GIBS; requesting today's date returns a blank black image.
   */
  dataLatencyDays: number;
}

/**
 * Returns the best available satellite/layer for the given longitude.
 * GOES GeoColor (true-color RGB, sub-daily) is used for the Americas and
 * Far Pacific. MODIS True Color (daily RGB) is used everywhere else —
 * including Asia-Pacific — because no Himawari true-color surface layer
 * exists in GIBS.
 */
export function selectSatellite(lng: number): SatelliteConfig {
  // Normalize to [-180, 180]
  const norm = ((lng + 180) % 360 + 360) % 360 - 180;

  if (norm >= -145 && norm < -5) {
    // Americas — GOES-East GeoColor (true-color RGB, 10-min cadence, near-real-time)
    return {
      name: 'GOES-East',
      layer: 'GOES-East_ABI_GeoColor',
      subDaily: true,
      dataLatencyDays: 0,
    };
  }

  if (norm > 160 || norm < -145) {
    // Far Pacific / Hawaii — GOES-West GeoColor (true-color RGB, 10-min cadence, near-real-time)
    return {
      name: 'GOES-West',
      layer: 'GOES-West_ABI_GeoColor',
      subDaily: true,
      dataLatencyDays: 0,
    };
  }

  // Asia-Pacific, Europe, Africa, Middle East — MODIS Terra True Color.
  // Daily cadence only; no sub-daily true-color surface product available in GIBS.
  // CorrectedReflectance uses Level-2G processing — data is available ~2 days after capture.
  return {
    name: 'MODIS-Terra',
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    subDaily: false,
    dataLatencyDays: 2,
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
// Bounding-box sizing — target 10,000 ft² coverage per image
// ---------------------------------------------------------------------------
// 10,000 ft² → side = √10,000 = 100 ft = 30.48 m = 0.03048 km
// delta (half-extent in degrees) = side_km / 2 / 111 km·deg⁻¹ ≈ 0.0001373°
//
// ⚠️  Resolution note: MODIS and GOES GeoColor have a native ground resolution
// of ~1 km/pixel. A 30 m × 30 m bounding box is well below one satellite pixel.
// The WMS server will return the nearest available data, which will appear as a
// uniform color patch. For meaningful sub-100 m imagery, a higher-resolution
// source such as Sentinel-2 (10 m) or Planet Labs (3 m) is required.
// ---------------------------------------------------------------------------
const TARGET_AREA_FT2 = 10_000;
const KM_PER_FT = 0.0003048;
// Side of the target square in degrees of latitude (≈ km / 111)
const TARGET_DELTA_DEG =
  (Math.sqrt(TARGET_AREA_FT2) * KM_PER_FT) / 2 / 111; // ≈ 0.0001373°

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches a time-series of satellite images for the given coordinates across
 * three day snapshots (T0, T-30, T-60).
 *
 * Sub-daily satellites (GOES-East, GOES-West):
 *   10 images per day at 30-min intervals centered on local solar noon → 30 images total.
 *   Averaging detections across the intraday samples reduces cloud-cover bias.
 *
 * MODIS (all other regions):
 *   1 daily composite per day → 3 images total (no intraday averaging).
 *
 * @param coords    - { lat, lng }
 * @param delta     - Half-extent in degrees around the point (default TARGET_DELTA_DEG ≈ 10,000 ft² coverage)
 * @param imageSize - Pixel dimensions for each fetched image (default 512)
 */
export async function fetchTimeseriesImages(
  coords: { lat: number; lng: number },
  delta = TARGET_DELTA_DEG,
  imageSize = 512
): Promise<DayBundle[]> {
  const { lat, lng } = coords;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const satellite = selectSatellite(lng);

  // Shift the baseline back by the satellite's data latency so T0 always
  // resolves to a date with confirmed data in GIBS (avoids blank black images).
  const baseline = subtractDays(new Date(), satellite.dataLatencyDays);
  const days = [
    { label: 'T0',   date: baseline },
    { label: 'T-30', date: subtractDays(baseline, 30) },
    { label: 'T-60', date: subtractDays(baseline, 60) },
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
