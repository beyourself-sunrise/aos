# PgSessionStorage Runbook

## Overview

PgSessionStorage is the PostgreSQL-backed implementation of the AOS `SessionStorage` interface.
It provides session persistence with optimistic locking for concurrent write safety.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              SessionStorage (interface)          │
│  getMetadata / getLeafId / setLeafId /          │
│  createEntryId / appendEntry / getEntry /        │
│  findEntries / getLabel / getPathToRoot /       │
│  getEntries                                      │
└────────────────────┬────────────────────────────┘
                     │ implements
┌────────────────────▼────────────────────────────┐
│              PgSessionStorage                     │
│  • Optimistic locking (version column)           │
│  • ConflictResolver (retry + backoff)            │
│  • Audit logging (optional)                      │
└────────────────────┬────────────────────────────┘
                     │ connects to
┌────────────────────▼────────────────────────────┐
│              PostgreSQL                          │
│  • aos_session (session metadata + version)      │
│  • aos_session_entry (entry tree)                │
│  • aos_migration (migration tracking)            │
└─────────────────────────────────────────────────┘
```

## Schema

### aos_session

| Column     | Type        | Description                    |
|------------|-------------|--------------------------------|
| id         | TEXT PK     | Session UUID                   |
| thread_id  | TEXT UNIQUE | External thread identifier     |
| agent_id   | TEXT        | Agent identity                 |
| metadata   | JSONB       | Session metadata               |
| leaf_id    | TEXT        | Current leaf entry ID          |
| version    | INTEGER     | Optimistic lock version        |
| created_at | TIMESTAMPTZ | Creation timestamp             |
| updated_at | TIMESTAMPTZ | Last update timestamp          |

### aos_session_entry

| Column     | Type        | Description                    |
|------------|-------------|--------------------------------|
| id         | TEXT PK     | Entry UUID                     |
| thread_id  | TEXT FK     → aos_session(thread_id) | Session reference |
| parent_id  | TEXT FK     → aos_session_entry(id)  | Parent entry (tree) |
| role       | TEXT        | user / assistant / tool / system |
| content    | JSONB       | Structured content             |
| metadata   | JSONB       | Entry metadata                 |
| created_at | TIMESTAMPTZ | Creation timestamp             |

## Running Migrations

### Apply all pending migrations

```bash
cd projects/AOS
npm run migrate:up
```

### Roll back all migrations

```bash
cd projects/AOS
npm run migrate:down
```

### Check applied migrations

```bash
psql -c "SELECT * FROM aos_migration ORDER BY version;"
```

## Querying Session Data

### List all sessions

```sql
SELECT id, thread_id, agent_id, version, created_at, updated_at
FROM aos_session
ORDER BY updated_at DESC;
```

### Get session entries

```sql
SELECT id, parent_id, role, content, created_at
FROM aos_session_entry
WHERE thread_id = 'thread-123'
ORDER BY created_at ASC;
```

### Get entry tree (path to root)

```sql
WITH RECURSIVE path AS (
  SELECT id, parent_id, role, content, created_at, 0 AS depth
  FROM aos_session_entry WHERE id = 'entry-xyz'
  UNION ALL
  SELECT e.id, e.parent_id, e.role, e.content, e.created_at, path.depth + 1
  FROM aos_session_entry e
  INNER JOIN path ON e.id = path.parent_id
)
SELECT * FROM path ORDER BY depth DESC;
```

### Count entries per session

```sql
SELECT s.thread_id, COUNT(e.id) AS entry_count
FROM aos_session s
LEFT JOIN aos_session_entry e ON e.thread_id = s.thread_id
GROUP BY s.thread_id
ORDER BY entry_count DESC;
```

## Optimistic Lock Conflict Monitoring

### Detect conflicts

Conflicts occur when two clients try to update the same session simultaneously.
The `ConflictResolver` automatically retries with exponential backoff (50/100/200ms).

Monitor conflict rate:

```sql
-- Check version jumps (indicates conflicts)
SELECT thread_id, version, updated_at
FROM aos_session
WHERE version > 1
ORDER BY updated_at DESC
LIMIT 100;
```

### Tuning retry parameters

The `ConflictResolver` accepts configurable parameters:

```typescript
const resolver = new ConflictResolver(
  maxRetries: 3,    // default: 3
  baseDelayMs: 50,  // default: 50ms (50/100/200ms backoff)
);
```

If conflicts are frequent, consider:
- Increasing `maxRetries` (default: 3)
- Increasing `baseDelayMs` (default: 50ms)
- Reviewing application-level concurrency patterns

## Audit Events

When audit is enabled, PgSessionStorage logs:

| Event Type                      | Triggered By    |
|---------------------------------|-----------------|
| `aos.session.entry.appended`   | `appendEntry`   |
| `aos.session.leaf.changed`     | `setLeafId`     |

### Query audit events

```sql
SELECT * FROM audit_event
WHERE event_type LIKE 'aos.session.%'
ORDER BY created_at DESC
LIMIT 100;
```

## Troubleshooting

### Migration fails

```bash
# Check migration status
psql -c "SELECT * FROM aos_migration;"

# Check table existence
psql -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'aos_%';"
```

### Connection refused

Ensure PostgreSQL is running:

```bash
cd projects/AOS/docker
docker compose up postgres -d
```

### Version conflict errors in logs

This is expected behavior — the `ConflictResolver` handles retries automatically.
If you see repeated conflicts, check for:
- Multiple agents writing to the same session
- Application-level race conditions
- Network latency causing stale version reads

## Testing

### Unit tests (mock PG)

```bash
cd projects/AOS
npm run test
```

### Integration tests (real PG)

```bash
cd projects/AOS/docker
docker compose up postgres -d
sleep 8  # wait for PG to be ready
cd ..
npm run migrate:up
npm run test:integration
cd docker
docker compose down
```
