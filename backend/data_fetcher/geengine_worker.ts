import axios from 'axios';

// NASA GIBS (Global Imagery Browse Services) — free, no API key required.
// Provides Sentinel-2 and MODIS imagery with historical date support.
const GIBS_WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const GIBS_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';

export interface SatelliteImage {
  label: string;
  date: string;
  imageBase64: string;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function subtractDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Fetches a time-series of three satellite images (T0, T-30, T-60) for the given
 * coordinates using NASA GIBS (free, no API key required).
 *
 * @param coords - { lat: number, lng: number }
 * @param delta  - Half-extent in degrees around the point (default 0.25°)
 * @param imageSize - Pixel dimensions for the fetched image (default 512)
 */
export async function fetchTimeseriesImages(
  coords: { lat: number; lng: number },
  delta = 0.25,
  imageSize = 512
): Promise<SatelliteImage[]> {
  const { lat, lng } = coords;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;

  const today = new Date();
  const timestamps = [
    { label: 'T0', date: formatDate(today) },
    { label: 'T-30', date: formatDate(subtractDays(today, 30)) },
    { label: 'T-60', date: formatDate(subtractDays(today, 60)) },
  ];

  console.log(`[GEE] Fetching ${timestamps.length} satellite images for coords: ${JSON.stringify(coords)}`);

  const images = await Promise.all(
    timestamps.map(async ({ label, date }) => {
      const url =
        `${GIBS_WMS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
        `&LAYERS=${GIBS_LAYER}&CRS=CRS:84` +
        `&BBOX=${bbox}&WIDTH=${imageSize}&HEIGHT=${imageSize}` +
        `&FORMAT=image/jpeg&TIME=${date}`;

      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      const imageBase64 = Buffer.from(response.data).toString('base64');
      console.log(`[GEE] Fetched ${label} (${date}) — ${response.data.byteLength} bytes`);
      return { label, date, imageBase64 };
    })
  );

  return images;
}
