# Sentree

## What Is Sentree?

Sentree is a **real-time deforestation monitoring system**. Users submit GPS coordinates, and the system automatically fetches historical satellite imagery, runs AI detection on each frame, and alerts the user if forest cover is actively declining over time.

---

## Tech Stack Breakdown

### 1. React 19 + TypeScript — Frontend Dashboard ([src/App.tsx](src/App.tsx))

**What it is:** A component-based UI framework for building interactive browser apps.

**What it does here:**
- Renders a monitoring dashboard with coordinate input
- Displays 3 satellite images side-by-side (T-60, T-30, T0 days)
- Overlays YOLO detection bounding boxes (red boxes with confidence %) directly on each image using canvas-like absolute positioning
- Shows a bar chart of deforestation area growth across timestamps
- Polls `/api/history/:aoi_id` every 5 seconds to pull in results as they process
- Displays an "Active Deforestation Alert" badge when the growth trend is confirmed

**Key interaction:** The frontend is a *passive consumer*. It submits a job, then polls until results arrive. There is no WebSocket — just REST polling.

---

### 2. Express.js — Backend API Server ([server.ts](server.ts))

**What it is:** A minimal Node.js HTTP framework. Acts as the API layer and Vite dev middleware host.

**What it does here:**
- `POST /api/monitor` — receives coordinates from the UI, writes to Redis watchlist, and publishes a job to Kafka
- `GET /api/history/:aoi_id` — reads processed results from Redis and returns them to the frontend
- In dev mode, proxies Vite's HMR. In production, serves the built `dist/` folder

**Key design:** The server is non-blocking. It does not run AI or fetch images itself — it just enqueues work to Kafka and returns immediately. The heavy lifting happens in a background consumer also running in the same process.

---

### 3. Apache Kafka (KafkaJS) — Event Streaming ([backend/distributed/kafka_wrapper.ts](backend/distributed/kafka_wrapper.ts))

**What it is:** A distributed message broker. Producers write to *topics*, consumers read from them asynchronously.

**What it does here:**
- Topic: `area-monitoring-requests`
- **Producer** (`DeforestationProducer`): called by `POST /api/monitor` to enqueue a job `{aoi_id, coords, userId}`
- **Consumer** (`DeforestationConsumer`, group `eco-sentry-workers`): picks up each job, fetches satellite images, runs YOLO, writes results to Redis

**Why Kafka and not a direct function call?**
Decoupling. The web request returns instantly without waiting for satellite fetches (which can be slow). It also means you could scale workers independently — 10 API servers and 50 processing workers running from the same topic.

**Current setup:** Single-node broker (1 partition, replication factor 1). Development-only — not production-safe.

---

### 4. Redis (ioredis) — State Store ([backend/distributed/redis_wrapper.ts](backend/distributed/redis_wrapper.ts))

**What it is:** An in-memory key-value store. Extremely fast for reads/writes.

**What it does here:**
- `watchlist:{userId}` → stores the coordinates a user is monitoring
- `area:{aoi_id}` → stores the full analysis result (frames, detection bboxes, areas in km², timestamps)
- Acts as the bridge between the Kafka consumer (writer) and the HTTP layer (reader)

**Why Redis and not a database?**
Two reasons from the architecture: (1) Speed — results need to be available to polling within seconds. (2) Deduplication — if multiple sensors fire for the same area, Redis can be used as a check-before-alert gate (not yet fully implemented, but that's the design intent).

---

### 5. NASA GIBS API — Satellite Imagery ([backend/data_fetcher/geengine_worker.ts](backend/data_fetcher/geengine_worker.ts))

**What it is:** NASA's Global Imagery Browse Services — a free WMS (Web Map Service) serving MODIS satellite imagery. No API key required.

**What it does here:**
- Given coordinates + a 0.25° radius (~25 km), builds a bounding box
- Fetches 3 PNG images at T0, T-30, T-60 days using MODIS Terra True Color layer
- Returns each as base64-encoded strings for downstream processing

**Why not Google Earth Engine?**
No auth needed with GIBS, making local development and CI trivially easy.

---

### 6. Roboflow YOLOv11 — AI Deforestation Detection ([backend/ai/yolo_engine.ts](backend/ai/yolo_engine.ts))

**What it is:** A cloud-hosted inference API for a YOLOv11 model trained on deforestation imagery (hosted at Roboflow Universe).

**What it does here:**
- Accepts a base64 image
- Returns detection bounding boxes with class labels (e.g., `deforestation`, `logging_road`) and confidence scores
- Each pixel bbox is converted to km² using latitude-aware geographic math:
  ```
  1° latitude ≈ 111 km
  1° longitude ≈ 111.32 × cos(lat) km
  ```

**Key output:** Per-detection `area_sqkm`, which feeds the growth comparison logic.

**Growth alert logic (in [server.ts](server.ts)):**
```
if areaT0 > areaT30 > areaT60 → ACTIVE DEFORESTATION (alert)
else → STABLE / NON-THREAT
```

---

### 7. Vite + TailwindCSS + Motion — Frontend Build & Styling

**Vite:** Fast dev server with HMR. Bundles React for production. Path alias `@/*` maps to `src/`.

**Tailwind v4:** Utility-first CSS, configured via plugin in `vite.config.ts`. No `tailwind.config.js` needed.

**Motion (Framer Motion):** Handles entrance animations on cards and alert badges.

---

### 8. Docker Compose — Local Infrastructure ([docker-compose.yml](docker-compose.yml))

Spins up:
- **Redis** on `localhost:6379`
- **Apache Kafka 3.8** on `localhost:9092` (KRaft mode — no ZooKeeper)

```bash
docker compose up -d
```

---

## Data Flow — End to End

```
User enters coords → POST /api/monitor
                         │
                         ├─→ Redis: add to watchlist
                         └─→ Kafka: publish job {aoi_id, coords}
                                          │
                              Kafka Consumer picks up job
                                          │
                              NASA GIBS: fetch T0, T-30, T-60 images
                                          │
                              Roboflow YOLO: detect on each image (×3)
                                          │
                              Compare areas: T0 > T-30 > T-60?
                                          │
                              Redis: store results {frames, areas, alert}
                                          │
                         Frontend polls GET /api/history/:aoi_id
                                          │
                         React renders satellite images + detection overlays
```

---

## What's Missing for Production

### Critical / Must-Have

| Gap | What's Needed |
|---|---|
| **Kafka durability** | Increase partitions and replication factor (min 3 replicas for fault tolerance). Add topic retention policy. |
| **Auth & multi-tenancy** | No user authentication exists. `userId` is hardcoded as `"user_default"`. Add JWT/session auth and scope all Redis keys by real user IDs. |
| **Redis persistence** | Default Redis config is in-memory only. Enable AOF (Append-Only File) or RDB snapshots so results survive restarts. |
| **Error handling & retries** | Kafka consumer has no dead-letter queue. A failed YOLO or GIBS call silently drops the job. Add retry logic + DLQ topic. |
| **Secret management** | Roboflow API key is in `.env` committed to the repo. Use a secrets manager (AWS Secrets Manager, Vault, etc.) in production. |
| **HTTPS / TLS** | No SSL. All traffic is plaintext. Put behind a reverse proxy (Nginx/Caddy) with TLS termination. |
| **Rate limiting** | No limits on `POST /api/monitor`. One user can flood Kafka. Add per-IP rate limiting at the API layer. |

### High Value / Should-Have

| Enhancement | Why |
|---|---|
| **WebSocket or SSE** | Replace 5-second polling with server-sent events for instant result delivery |
| **Map UI (Leaflet / Mapbox)** | Let users draw bounding boxes on a real map instead of typing raw lat/lng |
| **Persistent database (PostgreSQL)** | Redis is a cache, not a database. Historical trends and user watchlists should be in Postgres for durability and queryability |
| **Self-hosted YOLO model** | The Roboflow API has rate limits, latency, and cost at scale. Running YOLO locally (ONNX runtime or TorchServe) eliminates the external dependency |
| **Proper logging (Pino/Winston)** | Replace `console.log` with structured JSON logs. Ship to Datadog/Grafana Loki in prod |
| **Health check endpoints** | `/health` and `/ready` endpoints for Kubernetes liveness/readiness probes |
| **CI/CD pipeline** | GitHub Actions for lint → test → Docker build → deploy |
| **Containerize the app** | Add a `Dockerfile` for the Node.js server so everything runs in containers (not just Kafka/Redis) |
| **Monitoring & alerting** | Instrument with Prometheus metrics (Kafka consumer lag, YOLO latency, Redis hit rate) |
| **Email/SMS notifications** | Currently "alert" only lives in the UI. Wire to Twilio/SendGrid so users get notified even when the app is closed |
| **Confidence thresholds** | Currently all detections are accepted. Add a configurable minimum confidence filter (e.g., ignore detections < 0.5) |

---

## Getting Started Locally

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install deps
npm install

# 3. Set your env
cp .env.example .env
# add your ROBOFLOW_API_KEY

# 4. Run
npm run dev
# → http://localhost:5173
```

The backend and frontend run from a single `npm run dev` command — Express serves the API and Vite handles the frontend via middleware.
