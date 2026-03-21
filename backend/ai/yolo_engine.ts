import axios from 'axios';

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const MODEL_ENDPOINT = 'https://detect.roboflow.com/deforestation-3-i45zc/1';

export interface DetectionResult {
  class: string;
  area_sqkm: number;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * Runs the Roboflow deforestation detection model on a base64-encoded satellite image.
 * @param imageBase64 - The base64-encoded image (JPEG/PNG)
 * @param latCenter  - Latitude of the image center (for area calculation)
 * @param imageDeltaDeg - Half-extent of the image in degrees (default ≈ 0.0001373°, 10,000 ft² — must match fetchTimeseriesImages delta)
 * @param imageSize  - Pixel dimensions of the image (default 512)
 */
// Mirrors TARGET_DELTA_DEG in geengine_worker.ts: sqrt(10000) * 0.0003048 / 2 / 111
const DEFAULT_IMAGE_DELTA_DEG = (Math.sqrt(10_000) * 0.0003048) / 2 / 111;

export async function detectDeforestationSegments(
  imageBase64: string,
  latCenter = 0,
  imageDeltaDeg = DEFAULT_IMAGE_DELTA_DEG,
  imageSize = 512
): Promise<DetectionResult[]> {
  if (!ROBOFLOW_API_KEY) {
    throw new Error('ROBOFLOW_API_KEY is not set. Add it to your .env file.');
  }

  const response = await axios({
    method: 'POST',
    url: `${MODEL_ENDPOINT}?api_key=${ROBOFLOW_API_KEY}`,
    data: imageBase64,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const predictions: any[] = response.data.predictions ?? [];

  // Calculate sq km per pixel based on the image's geographic coverage
  const latExtentKm = imageDeltaDeg * 2 * 111.0;
  const lngExtentKm = imageDeltaDeg * 2 * 111.32 * Math.cos((latCenter * Math.PI) / 180);
  const pixelAreaSqKm = (latExtentKm / imageSize) * (lngExtentKm / imageSize);

  return predictions.map((pred) => ({
    class: pred.class,
    confidence: pred.confidence,
    area_sqkm: pred.width * pred.height * pixelAreaSqKm,
    bbox: { x: pred.x, y: pred.y, width: pred.width, height: pred.height },
  }));
}
