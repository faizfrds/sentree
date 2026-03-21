# Sentree

## The Problem: Sumatra's Vanishing Rainforest

Sumatra is home to one of the world's oldest and most biodiverse rainforests — a 300-million-year-old ecosystem that spans roughly 480,000 km². It is the last place on Earth where tigers, orangutans, rhinos, and elephants share the same habitat.

Over the past 30 years, **Sumatra has lost more than half of its forest cover**. Between 1990 and 2020, approximately 15 million hectares were cleared — an area larger than England — largely driven by palm oil expansion, illegal logging, and pulpwood plantations. What remains is fragmented, degraded, and under continuous pressure.

The consequences extend far beyond biodiversity. Sumatra's forests act as a natural sponge: they absorb rainfall, anchor soil, and regulate the flow of water through river catchments. When those forests are stripped away, the consequences are severe and immediate:

- **Flash floods in monsoon season** have become dramatically more frequent and intense. Provinces like Aceh, North Sumatra, and South Sumatra have recorded catastrophic floods nearly every rainy season in recent years, displacing hundreds of thousands of people.
- In 2020, flooding in South Kalimantan — driven by the same forest loss pattern — displaced over 100,000 residents in days.
- In Aceh, communities that once relied on predictable seasonal water flow now face both extreme flooding and extended dry-season droughts as watersheds collapse.

The link between deforestation and flood severity is well-established: deforested slopes shed rainwater 5–10× faster than forested ones, and Indonesia's compacted, clay-heavy soils offer little absorption capacity once the root systems that held them are gone.

**The monitoring gap is the core problem.** Illegal logging often happens deep in remote areas — accessible only by river or logging road — where no authority is present and where manual satellite review is weeks or months behind the cutting. By the time a violation is detected, the forest is already gone.

---

## What Is Sentree?

Sentree is a **real-time deforestation monitoring system**. Users submit GPS coordinates of any forest area, and the system automatically:

1. Fetches historical satellite images across three time windows (T-60, T-30, and T0 days)
2. Runs AI detection on each image to measure the footprint of deforested patches
3. Compares those measurements across time — if the clearing is actively growing, an alert fires

The goal is to collapse the detection lag from weeks to hours, giving rangers, NGOs, and government bodies the earliest possible warning that illegal activity is underway.

---

## How It Works (Simply)

```
You enter coordinates → The system fetches satellite images from the last 60 days
                      → AI scans each image for deforestation patches
                      → If the patches are growing, you get an alert
```

There are three days of imagery (T-60, T-30, T0). Each day, multiple images are captured at 30-minute intervals around midday to reduce the chance that clouds block the view. The AI averages all the clean images per day to produce a reliable area estimate.

If `area today > area 30 days ago > area 60 days ago`, the system flags it as **Active Deforestation**.

---

## Tech Stack

| Component | Role |
|---|---|
| **React + TypeScript** | Web dashboard — displays satellite images, detection overlays, and trend charts |
| **Express.js** | Backend API — accepts coordinate submissions, serves results |
| **Apache Kafka** | Job queue — decouples coordinate submission from the slow work of fetching images and running AI |
| **Redis** | Fast result cache — stores detection results so the dashboard can poll and display them in near-real-time |
| **NASA GIBS API** | Free satellite imagery (GOES-East, Himawari-9, MODIS) — no API key required |
| **Roboflow YOLOv11** | Cloud-hosted AI model trained on deforestation imagery — identifies cleared patches and logging roads |
| **Docker Compose** | Spins up Kafka and Redis locally with a single command |

---

## Data Flow

```
User enters coords → POST /api/monitor
                         │
                         ├─→ Redis: add to watchlist
                         └─→ Kafka: publish job {aoi_id, coords}
                                          │
                              Kafka Consumer picks up job
                                          │
                              Select satellite based on longitude
                              (GOES-East / Himawari-9 / GOES-West / MODIS)
                                          │
                              NASA GIBS: fetch 10 images × 3 days = 30 images
                              (30-min intervals, centered on local solar noon)
                                          │
                              Roboflow YOLO: detect on all 30 images
                                          │
                              Average area per day → [avgT0, avgT-30, avgT-60]
                                          │
                              Compare: avgT0 > avgT-30 > avgT-60?
                                          │
                              Redis: store results {frames, areas, alert}
                                          │
                         Frontend polls GET /api/history/:aoi_id
                                          │
                         React renders satellite images + detection overlays
```

---

## Satellite Coverage

| Region | Satellite | Frequency |
|---|---|---|
| Americas (−145° to −5°) | GOES-East | 10 images/day |
| Asia-Pacific incl. Sumatra (70° to 160°) | Himawari-9 | 10 images/day |
| Far Pacific / Hawaii (>160° or <−145°) | GOES-West | 10 images/day |
| Europe / Africa / Middle East (−5° to 70°) | MODIS-Terra | 1 image/day |

Sumatra (roughly 95°–106°E) falls squarely in the Himawari-9 coverage zone, giving the best possible intraday temporal resolution for that region.

---

## Getting Started

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Add your ROBOFLOW_API_KEY

# 4. Run
npm run dev
# → http://localhost:5173
```

The backend and frontend start together from a single command — Express handles the API and Vite handles the frontend via middleware.

---

## Scaling to a Real-World Application

The current build is a working proof of concept. Below is a concrete path to production.

### Immediate Hardening (Before Any Real Deployment)

| What | Why |
|---|---|
| **Add user authentication** | All user IDs are currently hardcoded. Add JWT auth so each user's watchlist and alerts are scoped correctly. |
| **Persist Redis to disk** | Default Redis is in-memory only. Enable AOF snapshots or switch results to PostgreSQL so nothing is lost on restart. |
| **Add a dead-letter queue in Kafka** | A failed image fetch or YOLO call silently drops the job. Route failures to a retry topic so no monitoring request is lost. |
| **Move secrets out of `.env`** | The Roboflow API key must go into a proper secrets manager (AWS Secrets Manager, HashiCorp Vault) before any shared deployment. |
| **Increase Kafka replication** | The current single-partition, single-replica setup will lose messages if the broker crashes. Set replication factor to 3 for any production cluster. |

### Growing the System

**Replace polling with push notifications.** The current dashboard polls every 5 seconds. At scale this is wasteful. Switching to Server-Sent Events (SSE) or WebSockets means the UI updates the moment a result is ready, and rangers in the field can receive push alerts on mobile.

**Add a map UI.** Typing raw coordinates is a friction point. Integrating Leaflet or Mapbox lets users draw bounding boxes directly on a map — critical for non-technical field staff.

**Run YOLO on your own infrastructure.** The Roboflow API has rate limits and per-inference costs. At monitoring scale (thousands of coordinates, 30 images each), those costs compound quickly. Hosting the YOLOv11 model on GPU instances (via ONNX Runtime or TorchServe) eliminates the dependency and reduces latency significantly.

**Add a time-series database.** Redis is a cache, not a database. For longitudinal analysis — tracking how a specific area has changed over 12 months, or generating reports for government agencies — a proper time-series database (InfluxDB, TimescaleDB on Postgres) is necessary.

**Wire in SMS and email alerts.** The alert currently only shows up in the browser. Field rangers are not sitting at dashboards. Connecting Twilio (SMS) and SendGrid (email) means an alert reaches the right person regardless of where they are.

**Containerize the application server.** Currently only Kafka and Redis run in Docker. Adding a `Dockerfile` for the Node.js server means the entire stack can be deployed to Kubernetes, enabling horizontal scaling of both the API and the Kafka consumer workers independently.

### Long-Term: A Nationwide Monitoring Grid

The architecture is designed to scale horizontally from the start. Each additional forest region is just another coordinate submitted to Kafka — the worker pool processes them in parallel without any code changes.

A regional deployment covering Sumatra's remaining forest would involve:

- **Pre-seeded watchlist**: NGOs or forestry agencies pre-load known high-risk areas (logging concession boundaries, protected zone perimeters) as permanent monitoring coordinates, rather than waiting for a human to notice a problem
- **Scheduled re-analysis**: A cron layer triggers re-analysis of each watchlist coordinate on a fixed cadence (every 7 or 30 days), rather than requiring a manual submission
- **Multi-agency alert routing**: Different alert channels for different stakeholders — rangers get SMS, ministry officials get email summaries, and NGOs get dashboard access
- **Integration with ground truth**: Connecting field reports from rangers (GPS-tagged photos of logging activity) back into the system to continuously validate and improve the AI model's accuracy over time
- **Higher-resolution imagery**: NASA GIBS provides free, moderate-resolution imagery. For precise boundary detection and legal-grade evidence, pairing with commercial providers (Planet Labs, Maxar) at selected high-risk sites would improve detection quality significantly

The core insight is that deforestation monitoring is fundamentally a data pipeline problem — and this stack is purpose-built for exactly that: event-driven, horizontally scalable, and decoupled at every layer.

---

## What's Currently Missing for Production

### Critical

| Gap | What's Needed |
|---|---|
| **Kafka durability** | Increase partitions and replication factor (min 3 replicas). Add topic retention policy. |
| **Auth & multi-tenancy** | No authentication exists. `userId` is hardcoded as `"user_default"`. |
| **Redis persistence** | In-memory only by default. Enable AOF or RDB snapshots. |
| **Error handling & retries** | No dead-letter queue. Failed jobs are silently dropped. |
| **Secret management** | Roboflow API key in `.env`. Use a secrets manager in production. |
| **HTTPS / TLS** | No SSL. Put behind a reverse proxy (Nginx/Caddy) with TLS termination. |
| **Rate limiting** | No limits on `POST /api/monitor`. One user can flood Kafka. |

### High Value

| Enhancement | Why |
|---|---|
| **WebSocket or SSE** | Replace 5-second polling with instant result push |
| **Map UI (Leaflet / Mapbox)** | Draw bounding boxes on a real map instead of typing raw coordinates |
| **PostgreSQL** | Durable storage for historical trends and user watchlists |
| **Self-hosted YOLO model** | Eliminate Roboflow rate limits and latency at scale |
| **Structured logging (Pino/Winston)** | Replace `console.log` with JSON logs, shipped to Datadog or Grafana Loki |
| **Health check endpoints** | `/health` and `/ready` for Kubernetes liveness/readiness probes |
| **CI/CD pipeline** | GitHub Actions: lint → test → Docker build → deploy |
| **Prometheus metrics** | Kafka consumer lag, YOLO inference latency, Redis hit rate |
| **Email/SMS notifications** | Wire alerts to Twilio/SendGrid for out-of-browser delivery |
| **Confidence thresholds** | Configurable minimum confidence filter (e.g., discard detections < 0.5) |
