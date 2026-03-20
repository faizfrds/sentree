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

    // 1. Fetch real satellite time-series images via NASA GIBS
    const images = await fetchTimeseriesImages(message.coords);

    // 2. Run Roboflow YOLO inference on each image
    const results = await Promise.all(
      images.map((img) =>
        detectDeforestationSegments(img.imageBase64, message.coords.lat)
      )
    );

    // 3. Aggregate total detected deforestation area per timestamp
    const areas = results.map((r) =>
      r.reduce((acc, det) => acc + det.area_sqkm, 0)
    );
    const [areaT0, areaT30, areaT60] = areas;

    console.log(
      `[Worker] Areas: T0=${areaT0.toFixed(2)}, T-30=${areaT30.toFixed(2)}, T-60=${areaT60.toFixed(2)} sq km`
    );

    // 4. Persist results to Redis (images, detections, and areas)
    await redis.setAreaHistory(message.aoi_id, {
      areas,
      timestamps: images.map((i) => i.date),
      frames: images.map((img, i) => ({
        label: img.label,
        date: img.date,
        imageBase64: img.imageBase64,
        detections: results[i],
      })),
      timestamp: new Date().toISOString(),
    });

    // 5. Alert if area is growing across all three periods
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
