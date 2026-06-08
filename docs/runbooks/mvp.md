# AOS MVP Runbook

> Operational runbook for AOS MVP capabilities: multi-agent personas, observational memory, workflows, and admin UI.

## Table of Contents

1. [Persona Agent Startup](#1-persona-agent-startup)
2. [HR Assistant Runbook](#2-hr-assistant-runbook)
3. [Finance Controller Runbook](#3-finance-controller-runbook)
4. [Workflow Monitor Runbook](#4-workflow-monitor-runbook)
5. [IT Ops Runbook](#5-it-ops-runbook)
6. [Observational Memory](#6-observational-memory)
7. [Workflows v1](#7-workflows-v1)
8. [Admin UI](#8-admin-ui)
9. [10 User Persona Scenarios](#9-10-user-persona-scenarios)
10. [Verification](#10-verification)

---

## 1. Persona Agent Startup

### Starting All Personas

```bash
# Start AOS with all personas
cd projects/AOS
npm run dev

# Or start specific persona
AOS_PERSONAS=hr-assistant,finance-controller npm run dev
```

### Persona Configuration

Personas are defined as YAML files in `src/agents/`:

| File | Persona | Tools | Triggers |
|------|---------|-------|----------|
| `hr-assistant.yaml` | HR Assistant | user-attendance, user-payroll, user-organize, workflow | cron, kafka, webhook |
| `finance-controller.yaml` | Finance Controller | cost-collection, expense-claim-bridge, erpnext-bridge | cron, kafka, report |
| `workflow-monitor.yaml` | Workflow Monitor | workflow-module, audit_event | cron, kafka |
| `it-ops.yaml` | IT Ops | audit_event (system health) | cron, kafka, webhook |

### Verifying Persona Startup

```bash
# Check audit log for persona initialization
curl http://localhost:3000/api/aos/audit?type=aos.persona.initialized

# Expected: 4 events (one per persona)
```

---

## 2. HR Assistant Runbook

### Scenario: Employee Leave Auto-Review

**Trigger**: Kafka event `user-attendance.leave-submitted` or cron at 9:00 AM weekdays.

**Flow**:
1. HR agent receives leave request event
2. Recalls past observations about employee patterns
3. Checks leave against policy limits
4. Auto-approves if within policy, flags for human review if not
5. Writes observation about decision

**Debug**:
```bash
# Check HR agent audit events
curl "http://localhost:3000/api/aos/audit?actor=hr-assistant&type=aos.execution.started"

# Check observations
curl "http://localhost:3000/api/aos/audit?actor=hr-assistant&type=aos.observation.stored"
```

### Scenario: Onboarding Workflow

**Trigger**: Webhook from HR system or manual initiation.

**Flow**:
1. Start onboarding workflow via `workflow.startOnboarding`
2. Create employee account, assign department, provision access
3. Track steps via workflow state machine
4. Complete when all steps done

---

## 3. Finance Controller Runbook

### Scenario: Expense Anomaly Detection

**Trigger**: Kafka event `cost-collection.expense-submitted` or cron at 10:00 AM weekdays.

**Flow**:
1. Finance agent scans expense claims
2. Detects anomalies (amount, frequency, pattern)
3. Flags claims exceeding thresholds
4. Notifies relevant stakeholders
5. Writes observation about anomaly patterns

**Debug**:
```bash
# Check finance agent events
curl "http://localhost:3000/api/aos/audit?actor=finance-controller"

# Check workflow transitions
curl "http://localhost:3000/api/aos/audit?type=aos.workflow.transitioned"
```

### Scenario: Monthly Cost Report

**Trigger**: Cron on 1st of month at 8:00 AM.

**Flow**:
1. Generate monthly cost report
2. Compare against budget
3. Flag significant variances (>10%)
4. Write observation about cost trends

---

## 4. Workflow Monitor Runbook

### Scenario: BPMN SLA Monitoring

**Trigger**: Cron every 5 minutes.

**Flow**:
1. Check active BPMN workflows against SLA targets
2. Flag workflows approaching SLA limits
3. Escalate breached workflows
4. Write observation about SLA patterns

**Debug**:
```bash
# Check SLA monitoring events
curl "http://localhost:3000/api/aos/audit?actor=workflow-monitor"
```

### Scenario: API Error Rate Monitoring

**Trigger**: Cron every 5 minutes or Kafka `api.error-rate-high`.

**Flow**:
1. Monitor API error rates across services
2. Detect error rate spikes (>5% threshold)
3. Create incident for high-severity spikes
4. Write observation about error patterns

---

## 5. IT Ops Runbook

### Scenario: Deploy Health Check

**Trigger**: Cron every 5 minutes.

**Flow**:
1. Check deployment status of all services
2. Detect failed deployments
3. Trigger rollback if needed
4. Write observation about deployment patterns

### Scenario: PG Connection Pool Monitoring

**Trigger**: Cron every 15 minutes.

**Flow**:
1. Check PG connection pool utilization
2. Alert when utilization >80%
3. Trigger pool scaling if needed
4. Write observation about connection patterns

---

## 6. Observational Memory

### How It Works

1. **Session End**: Agent runner calls `summarizeSession()` → `writeObservation()`
2. **Storage**: Observation stored in `aos_observation` table with pgvector embedding
3. **Session Start**: Agent runner calls `recallObservations()` → injects as system context

### Database Schema

```sql
-- Table: aos_observation
-- Columns: id, agent_id, content, embedding vector(1536), source_session_id, type, metadata, created_at
-- Index: HNSW on embedding (cosine distance)
```

### Debugging

```bash
# Check observation count per agent
psql -c "SELECT agent_id, COUNT(*) FROM aos_observation GROUP BY agent_id;"

# Check recent observations
psql -c "SELECT agent_id, type, content FROM aos_observation ORDER BY created_at DESC LIMIT 10;"

# Verify pgvector extension
psql -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### Memory Policy

Each persona has a `memoryPolicy` in its YAML config:
- `writeOn`: Events that trigger observation storage
- `recallScope`: `agent` (agent-specific) or `global`
- `topK`: Number of observations to recall (default: 5)

---

## 7. Workflows v1

### State Machine

```
pending → running → waiting → done
              ↓         ↓
            failed   failed (timeout)
```

### Starting a Workflow

```typescript
const workflow = await runner.startWorkflow('hr-assistant', 'leave-review', {
  employeeId: 'EMP001',
  leaveType: 'annual',
});
```

### Running Steps

```typescript
// Synchronous step
await runner.runSyncStep(workflow.id, 'check-policy', async (ctx) => ({
  ...ctx,
  withinPolicy: true,
}));

// Asynchronous step (wait for trigger)
await runner.awaitAsyncStep(workflow.id, {
  step: 'await-approval',
  wakeOn: { type: 'kafka', source: 'approval' },
  timeoutMs: 24 * 60 * 60 * 1000, // 24 hours
});
```

### Timeout Handling

Timeout cron job runs every 5 minutes:
```typescript
// In index.ts or cron handler
const triggerWake = new TriggerWake(runner, audit);
await triggerWake.scanTimeouts();
```

### Debugging

```bash
# Check workflow states
psql -c "SELECT id, name, state, current_step, version FROM aos_workflow ORDER BY created_at DESC;"

# Check waiting workflows
psql -c "SELECT id, name, timeout_at FROM aos_workflow WHERE state = 'waiting';"

# Check workflow transitions in audit
curl "http://localhost:3000/api/aos/audit?type=aos.workflow.transitioned"
```

---

## 8. Admin UI

### Access

Navigate to `/aos/admin` in the frontend application.

### Features

- **Event List**: All AOS audit events with type, actor, timestamp, payload
- **Filters**: Date range, event type, actor
- **Summary**: Event count by type
- **Color Coding**: Events color-coded by category (execution, observation, workflow, persona, trigger)

### Configuration

Set `VITE_AOS_API_BASE` environment variable to point to AOS server:
```bash
VITE_AOS_API_BASE=http://localhost:3000
```

---

## 9. 10 User Persona Scenarios

| # | Scenario | Persona | Trigger | Key Tools |
|---|----------|---------|---------|-----------|
| 1 | HR 假勤自動審 | hr-assistant | cron/kafka | user-attendance.* |
| 2 | Expense 異常偵測 | finance-controller | cron/kafka | cost-collection.* |
| 3 | BPMN SLA 監控 | workflow-monitor | cron | workflow-module.* |
| 4 | Deploy 健康 | it-ops | cron | audit_event.* |
| 5 | 入職流程 | hr-assistant | webhook | workflow.startOnboarding |
| 6 | 月度成本報表異常 | finance-controller | cron | cost-collection.* |
| 7 | BPMN 瓶頸分析 | workflow-monitor | cron | workflow-module.* |
| 8 | PG 連線池監控 | it-ops | cron | audit_event.* |
| 9 | 離職流程 | hr-assistant | webhook | workflow.startOffboarding |
| 10 | API 異常率監控 | workflow-monitor | cron/kafka | audit_event.* |

### Running Scenario Tests

```bash
# Run all persona scenario tests
cd projects/AOS
npm run test:integration -- tests/integration/persona-scenarios/

# Run specific scenario
npm run test:integration -- -t "Scenario 1"
```

---

## 10. Verification

### Pre-deployment Checklist

- [ ] pgvector extension enabled on target PG instance
- [ ] Migrations 0005 and 0006 applied
- [ ] All 4 persona YAML files present in `src/agents/`
- [ ] Audit bridge configured with correct DB connection
- [ ] Kafka brokers configured for trigger sources
- [ ] Frontend `VITE_AOS_API_BASE` points to AOS server

### Environment Verification

```bash
# Check pgvector
psql -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Check migrations
psql -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'aos_%';"

# Expected tables: aos_session, aos_observation, aos_workflow, aos_trigger_subscription, aos_audit

# Check persona configs
ls -la projects/AOS/src/agents/*.yaml

# Check audit events
curl http://localhost:3000/api/aos/audit/summary
```

### Health Checks

```bash
# AOS server health
curl http://localhost:3000/health

# Audit API health
curl http://localhost:3000/api/aos/audit/types

# Admin UI health
curl http://localhost:3000/api/aos/audit/summary
```

---

## Troubleshooting

### pgvector Not Available

```bash
# Enable pgvector extension
psql -c "CREATE EXTENSION IF NOT EXISTS vector;"

# If extension not found, install pgvector package for your PG version
# Debian/Ubuntu: apt-get install postgresql-contrib
# Then: psql -c "CREATE EXTENSION vector;"
```

### Workflow Timeout Not Firing

```bash
# Check timeout cron is running
# Verify timeout_at is set correctly
psql -c "SELECT id, name, state, timeout_at, NOW() as now FROM aos_workflow WHERE state = 'waiting';"

# Manually trigger timeout scan
# (add debug endpoint or call scanTimeouts() directly)
```

### Observations Not Recalling

```bash
# Check embedding dimension
psql -c "SELECT array_length(embedding, 1) FROM aos_observation LIMIT 1;"

# Verify HNSW index exists
psql -c "SELECT indexname FROM pg_indexes WHERE tablename = 'aos_observation';"
```

### Persona Not Starting

```bash
# Check YAML syntax
node -e "const yaml = require('js-yaml'); const fs = require('fs'); yaml.load(fs.readFileSync('src/agents/hr-assistant.yaml')); console.log('OK');"

# Check audit for initialization events
curl "http://localhost:3000/api/aos/audit?type=aos.persona.initialized"
```
