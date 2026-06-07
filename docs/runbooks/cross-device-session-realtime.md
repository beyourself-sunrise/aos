# AOS Cross-Device Session Realtime — Runbook

## Overview

This service provides cross-device session realtime tracking for AOS (Agent Operating System).
It uses Kafka for pub/sub and socket.io for WebSocket/SSE push to multiple devices.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Device A   │────▶│  Kafka       │────▶│  Device B    │
│  (writer)   │     │  (pub/sub)   │     │  (reader)    │
└─────────────┘     └──────────────┘     └──────────────┘
                      │                    ▲
                      ▼                    │
              ┌──────────────┐             │
              │  AOS Server  │─────────────┘
              │  (socket.io) │  (emit)
              └──────────────┘
```

## Components

### SessionEventBus
- Publishes session events to Kafka topic `aos.session.{threadId}`
- Key: `threadId` (guarantees per-thread ordering)
- Value: JSON `{ eventType, threadId, entry, version, timestamp, sourceDeviceId }`

### RealTimeStreamService
- Consumes all `aos.session.*` topics
- Emits events to socket.io rooms via SubscriptionRegistry

### SubscriptionRegistry
- Tracks `threadId → Set<connectionId>` (forward)
- Tracks `connectionId → Set<threadId>` (reverse)
- O(1) lookup for both directions

### CrossDeviceConflictResolver
- Tracks `threadId → Map<deviceId, version>`
- Detects conflicts when a device writes behind another device's version
- P0 strategy: last-write-wins

## API Endpoints

### SSE Stream
```
GET /api/aos/sessions/{threadId}/stream
```
Returns an SSE stream of session events.

### WebSocket (socket.io)
```
socket.on('subscribe', threadId)
socket.on('unsubscribe', threadId)
socket.on('session_event', event => { ... })
```

### REST Subscribe
```
POST /api/aos/sessions/{threadId}/subscribe
Body: { deviceId: string }
```

### REST Unsubscribe
```
DELETE /api/aos/sessions/{threadId}/subscribe
Body: { deviceId: string }
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker addresses |
| `PORT` | `3000` | HTTP port |

## Development

### Start Kafka (dev)
```bash
cd projects/AOS/docker
docker compose -f kafka.yml up -d
```

### Start AOS server
```bash
cd projects/AOS
npm run dev
```

### Run tests
```bash
npm run test          # unit tests
npm run test:integration  # integration tests (requires Kafka)
```

## Monitoring

### Key Metrics
- Subscription count per thread: `registry.getSubscriptionCount(threadId)`
- Event latency: time from Kafka publish to socket.io emit
- Conflict rate: number of conflicts detected per hour

### Health Check
```bash
curl http://localhost:3000/api/aos/health
```

## Troubleshooting

### Kafka connection issues
- Check `KAFKA_BROKERS` env var
- Verify Kafka is running: `docker compose -f docker/kafka.yml ps`

### Events not delivered
- Check SubscriptionRegistry has subscribers: `registry.getSubscribers(threadId)`
- Check Kafka consumer group: `aos-realtime-stream`

### Cross-device conflicts
- Check device versions: `resolver.deviceVersions`
- Review conflict resolution strategy
