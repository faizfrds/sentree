import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { DeforestationProducer, DeforestationConsumer } from './backend/distributed/kafka_wrapper';
import { RedisWatcherState } from './backend/distributed/redis_wrapper';
import { fetchTimeseriesImages } from './backend/data_fetcher/geengine_worker';
import { detectDeforestationSegments } from './backend/ai/yolo_engine';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const redis = new RedisWatcherState();
  const producer = new DeforestationProducer();
  const consumer = new DeforestationConsumer();

  // Background worker: consumes Kafka messages and runs the full AI pipeline
  await consumer.onMessage(async (message: any) => {
    console.log(`[Worker] Processing AOI: ${message.aoi_id}`);

    // 1. Fetch 30 satellite images: 3 days × 10 sub-daily samples at 30-min intervals
    const bundles = await fetchTimeseriesImages(message.coords);

    // 2. For each day bundle, run YOLO on all 10 images and compute the average
    //    deforestation area — averaging across intraday samples reduces cloud cover bias
    const dayResults = await Promise.all(
      bundles.map(async (bundle) => {
        const detectionSets = await Promise.all(
          bundle.images.map((img) =>
            detectDeforestationSegments(img.imageBase64, message.coords.lat)
          )
        );

        const perImageAreas = detectionSets.map((dets) =>
          dets.reduce((acc, det) => acc + det.area_sqkm, 0)
        );
        const avgArea = perImageAreas.reduce((a, b) => a + b, 0) / perImageAreas.length;

        // Use the middle image as the representative display frame
        const midIdx = Math.floor(bundle.images.length / 2);

        console.log(
          `[Worker] ${bundle.label} (${bundle.date}): avg area=${avgArea.toFixed(2)} sq km ` +
          `across ${bundle.images.length} samples [${perImageAreas.map(a => a.toFixed(2)).join(', ')}]`
        );

        return {
          label: bundle.label,
          date: bundle.date,
          avgArea,
          representativeImage: bundle.images[midIdx].imageBase64,
          representativeDetections: detectionSets[midIdx],
        };
      })
    );

    // 3. Use per-day averaged areas for the growth trend comparison
    const areas = dayResults.map((r) => r.avgArea);
    const [areaT0, areaT30, areaT60] = areas;

    console.log(
      `[Worker] Avg areas — T0=${areaT0.toFixed(2)}, T-30=${areaT30.toFixed(2)}, T-60=${areaT60.toFixed(2)} sq km`
    );

    // 4. Persist results to Redis — frames shape is unchanged so the frontend works as-is
    await redis.setAreaHistory(message.aoi_id, {
      areas,
      timestamps: dayResults.map((r) => r.date),
      frames: dayResults.map((r) => ({
        label: r.label,
        date: r.date,
        imageBase64: r.representativeImage,
        detections: r.representativeDetections,
      })),
      timestamp: new Date().toISOString(),
    });

    // 5. Alert if averaged area is growing across all three periods
    if (areaT0 > areaT30 && areaT30 > areaT60) {
      console.log(
        `\x1b[31m[ALERT] DEFORESTATION TREND DETECTED in AOI: ${message.aoi_id}! ` +
        `Growth: ${areaT60.toFixed(2)} → ${areaT30.toFixed(2)} → ${areaT0.toFixed(2)} sq km\x1b[0m`
      );
    }
  });

  // POST /api/monitor — submit an area-of-interest for monitoring
  app.post('/api/monitor', async (req, res) => {
    const { userId, coords: rawCoords } = req.body;

    // Accept either { lat, lng } object or "lat, lng" string (from the frontend text input)
    let coords: { lat: number; lng: number };
    if (typeof rawCoords === 'string') {
      const parts = rawCoords.split(',').map((s: string) => parseFloat(s.trim()));
      if (parts.length !== 2 || parts.some(isNaN)) {
        res.status(400).json({ error: 'coords must be "lat, lng" or { lat, lng }' });
        return;
      }
      coords = { lat: parts[0], lng: parts[1] };
    } else if (rawCoords?.lat != null && rawCoords?.lng != null) {
      coords = { lat: Number(rawCoords.lat), lng: Number(rawCoords.lng) };
    } else {
      res.status(400).json({ error: 'coords must be "lat, lng" or { lat, lng }' });
      return;
    }

    const aoi_id = `aoi_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[API] New monitoring request: ${aoi_id} for user ${userId}`);

    await redis.addToWatchlist(userId, coords);
    await producer.send({ aoi_id, coords, userId });

    res.json({ status: 'queued', aoi_id });
  });

  // GET /api/history/:aoi_id — retrieve stored area history from Redis
  app.get('/api/history/:aoi_id', async (req, res) => {
    const history = await redis.getAreaHistory(req.params.aoi_id);
    res.json(history ?? { error: 'Not found' });
  });

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Eco-Sentry server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Fatal] Failed to start server:', err);
  process.exit(1);
});
