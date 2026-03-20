Title: Project Sentree

Inspired by: Rainforest Connection (Acoustic monitoring) and Microsoft (AI for Earth).
Problem Statement: Illegal logging often happen in vast, unmonitored areas. Authorities cannot be everywhere, and manual review of satellite or audio data is too slow for immediate intervention.
Proposed solution: Organizations utilize satellite imagery that automatically processes historical data in order to determine if an area is experiencing illegal logging. Users can enter multiple locations to monitor and setup alarms that automatically alerts them to abnormal and drastic changes to a forest cover.
How AI/Distributed Systems Help:
Kafka: Streams "event triggers" from remote satellite sensors to a central processing hub.
Redis: Manages "Deduplication"—ensuring that multiple sensors picking up the same sound don't trigger five different emergency alerts.
AI Justification: YOLO model that can identify areas of deforestation

System-Level Overview: Targeted Eco-Sentry
1. The User Interface & Request Layer (The Trigger)
Input: A web-based map where a user draws a bounding box (Polygon) or enters a coordinate.
Redis as a Registry: When a user submits an area, the coordinates and the user's ID are stored in Redis. This acts as your "Active Watchlist."
Kafka Role: A "Monitoring Request" is pushed to a Kafka topic (area-monitoring-requests). This decoupling allows the system to handle 1 or 1,000 users without the frontend hanging.
2. The Data Acquisition Worker (The Fetcher)
Function: A background worker consumes the request from Kafka. It calls the Google Maps Static API (or Google Earth Engine) to pull a "Time-Series" of images for that coordinate (e.g., T-0 days, T-30 days, T-60 days).
Challenge Solved: By fetching multiple historical timestamps immediately, you provide the context needed to distinguish between "cleared land" and "seasonal changes."
3. The AI Inference Pipeline (YOLOv11 + Logic)
Detection: YOLOv11 processes each image in the time series. It identifies "Deforestation Patches" as bounding boxes.
Classification: The model categorizes the detection (e.g., clear_cut, logging_road, or burned_area).
The "Growth" Logic: * The system compares the area (pixels/meters) of the detected boxes across the timestamps.
If $Area_{T0} > Area_{T-30} > Area_{T-60}$, the system flags it as Active Deforestation.
If the area is static or shrinking (regrowth), it is flagged as a Stable/Non-Threat zone.
4. The State Store (Redis)
Tracking Growth: Redis stores the calculated area of deforestation for every "Watchlist" item.
Example Key: user:123:area:amazon_sector_4:sq_km -> 14.5.
Alerting: If the AI's new calculation exceeds the value stored in Redis by a certain threshold (e.g., >5%), a "Deforestation Event" is triggered.

YOLO API to use: https://universe.roboflow.com/faizs-workspace-2oalr/deforestation-3-i45zc/model/1

You are a senior fullstack engineer currently building Sentree. You are tasked with building this project that connects a YOLO api, kafka, and redis. Before publishing each task, you must generate tests that validates the code is doing what it is intended to do.

When in doubt, switch to planning mode and refer to the project outline on this file before continuing to implement change. When you encounter an error, note it down on this file to ensure the same mistakes are not repeated.