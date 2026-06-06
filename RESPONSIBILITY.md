# projects/AOS Responsibility

## Role

`projects/AOS/` 是 **Agent Operating System (AOS)** 的 workspace 命名空間。

AOS 是企業中的 **AI 員工運行平台** — 讓 AI Agent 像真人一樣**主動找事做**，
與人類員工共存於同一企業系統中。

### 核心設計哲學

> **AOS 是獨立應用，像真人一樣是主動找事做，而不是被 workflow 支配。**

- 現有 Agent 平台（Claude Code、Codex、Pi、OpenHands）皆將 session 與人類使用者綁定，
  導致 Agent 被動等指令 → 不可替換、難融入企業流程。
- AOS 翻轉此設計：AI Agent 與人類員工對等，擁有 **自己的 agenda、排程、訊息來源**。
- AOS 不是 BPMN 的 assignee；AOS 與 workflow-module 對等，
  視需要主動**啟動**流程。

### AOS 與既有系統的關係

```
Enterprise System
├─ BPMN Workflow    (workflow-module)        ← 對等：AOS 可啟動流程
├─ ERP Services     (各 domain module)       ← 工具：透過 MCP 呼叫
├─ HR Services      (user-* modules)         ← 工具：透過 MCP 呼叫
├─ Other AOS peers  (multi-instance 協作)    ← 同儕：Kafka topic 協作
└─ Agent OS         (projects/AOS/)          ← 本文件
   ├─ Agent Identity
   ├─ Agent Session (跨裝置即時追蹤，PG + SSE/WS)
   ├─ Agent Task Inbox (主動觸發收集)
   ├─ Agent Tool Gateway (MCP client/server)
   ├─ Agent Memory (pgvector + observational)
   ├─ Agent Audit (落既有 audit_event)
   └─ Agent Runtime (Pi SDK-based)
       ├─ Pi Agent class (執行單位)
       ├─ AOS Adapter (長程管理者)
       ├─ Self-written Schedules (croner)
       └─ Self-written Signals / Channels
```

## Owns

AOS 擁有下列十項核心職責領域（其中七項為原有，三項為本次 pivot 新增）：

### 既有七項（`establish-aos-folder` 定義）

#### 1. Agent Identity
Agent 作為系統使用者存在。
- Agent User（AI 員工帳號）
- Agent Department（組織歸屬）
- Agent Role（角色權限）
- 引用但不擁有 user/org/role master data（歸 user-* / organize-module / role-module）

#### 2. Agent Session（含跨裝置即時追蹤）
Session 屬於 Agent，為 Agent 的工作上下文。
- **長期連續性**：跨日、跨週的 session 持久化（PG-backed `SessionStorage`）
- **跨裝置即時追蹤**：任何裝置可訂閱同一 session；session 變更透過 Kafka + SSE/WS 即時推送
- **suspend / resume**：可暫停、恢復、跨裝置接續
- **Context compaction**：自動壓縮對話歷史（Pi SDK 內建）
- **衝突解決**：PG 樂觀鎖偵測多寫者（last-write-wins 或 retry）
- **設計原點**：Pi SDK 設計為「單一 Agent 程序持有 session」；AOS 自寫 PG `SessionStorage` 實作 + 即時通訊層
- **實作元件**（5 個，共 850-1,600 行）：
  1. `PgSessionStorage`（Pi SessionStorage 介面的 PG 實作）
  2. `SessionEventBus`（session.appendEntry → Kafka publish）
  3. `RealTimeStreamService`（SSE/WS 推播）
  4. `ConflictResolver`（樂觀鎖衝突偵測）
  5. `SubscriptionRegistry`（追蹤訂閱者）

#### 3. Agent Task Inbox
AOS 觸發後的工作集合，**不僅限於 BPMN**：
- BPMN User Task（從 workflow-module 接收；**AOS 仍可被派工**，但不是主要模式）
- 系統任務
- 人工指派任務
- **AOS 主動建立的任務**（proactive tasks）
- **同儕 AOS 訊息**（peer tasks）

#### 4. Agent Runtime（Pi SDK-based）
Agent 接收、理解（LLM-powered）、執行、完成任務的運行環境。
- **核心 runtime**：`@earendil-works/pi-agent-core`（8K lines / MIT）— Agent class、tool calling loop、events
- **LLM 抽象**：`@earendil-works/pi-ai`（31K lines / MIT）— 18 個 LLM providers 統一抽象
- **JSON Schema 驗證**：typebox（編譯時 schema，Pi 內建；零 runtime overhead）
- Tool calling loop（Pi 內建）
- 結構化輸出
- 推理與規劃
- **Long-running execution**（天/週/月級任務）
- **AOS Adapter 層**：包裝 Pi Agent 為「執行單位」，處理 proactive lifecycle（suspend / resume / 跨觸發源）
- **LLM 統一入口**：候選 — 既有 `agent-gateway`（FastAPI LiteLLM）或 Pi AI 直接呼叫（待 `aos-pi-poc` 評估）

#### 5. Agent Tool Gateway
統一管理 AOS 可用的系統能力。
- **MCP client**（呼叫既有 backend module 透過 MCP 暴露的工具）
- **MCP server**（AOS 對外發布工具，供其他 AOS 或系統呼叫）
- 既有 backend API 不需改動，由 MCP bridge 層包裝
- 工具權限 / 限流 / 審計在 MCP 層統一處理

#### 6. Agent Memory
Agent 的工作記憶與長期知識。
- 短期工作上下文（in-session）
- 長期記憶儲存（observational memory）
- 跨 session 知識累積
- 語意檢索（pgvector / Mastra vector store）
- 記憶治理（過期、隔離、scope）

#### 7. Agent Audit
完整記錄 Agent 所有行為。
- 任務接收與完成
- 工具呼叫（含參數、result、duration、agent reasoning）
- 決策過程（為何選某 tool、為何派工給某 AOS）
- 主動觸發的來源與判斷
- 資料查看與修改
- 流程參與（initiator / participant）
- 跨 AOS 協作訊息
- 所有操作可追溯、可審計

### 新增三項（本次 pivot 定義）

#### 8. Agent Scheduler（內部排程）
AOS 內建 **cron-like scheduler**，像人類員工的「固定會議」一樣定時觸發：
- 每日 9:00 掃描業務報表
- 每週一 10:00 檢視上週數據
- 每月 1 號產生月報
- 工作日 / 輪班 / on-call 概念
- **AOP 攔截所有主動觸發，記錄判斷依據**

#### 9. Agent Signals & Channels（多源觸發）
AOS 接收多元來源的觸發，**主動找事做**：

| 觸發源 | 範例場景 | 對應 Mastra 概念 |
|--------|----------|------------------|
| 排程 / cron | 每日掃描報表 | `Schedules` |
| Kafka 事件 | 訂單建立、庫存變動 | `Signals` |
| 人類訊息（Slack / IM） | 「幫我看一下這個」 | `Channels` |
| 報表 / 異常（BI / 監控） | 數字異常、開 ticket | `Signals` + `Background Tasks` |
| 外部 API / Webhook | GitHub PR、Jira issue、ERP event | `Channels` |
| 同儕 AOS 訊息 | AOS-A 通知 AOS-B 接手 | `Networks` |

每個觸發都附帶「為什麼觸發」、「判斷依據」、「行動計畫」 — 全部落 audit log。

#### 10. Agent Supervisor（監督與派工）
多個 AOS 員工協作時，需要 supervisor 角色：
- 接收觸發後判斷哪個 AOS 最適合執行
- 派工給下層 AOS agent（透過 Mastra networks）
- 監控 AOS 執行狀態
- 失敗重試、escalation
- 跨 AOS 訊息路由

## Does Not Own

AOS 明確不擁有下列職責，避免重疊：

| 不擁有 | 為什麼 | 歸誰 |
|--------|--------|------|
| **BPMN 工作流引擎** | workflow-module 已實作 Camunda 7 | workflow-module |
| **ERP 業務邏輯** | 各 domain module 已有 | inventory / procurement / manufacturing / sales / ... |
| **HR 真相資料** | user-attendance / user-payroll 擁有 | user-attendance / user-payroll / user-organize |
| **認證與授權** | security-module 完整 | security-module |
| **User / Org / Role master data** | 既有 RBAC 已成熟 | user-core / user-organize / user-role |
| **dev-agent bootstrap** | agent-workspace 用途 | agent-workspace |
| **Coding agent runtime** | Claude Code / Codex / Pi 已實作 | 外部工具鏈 |
| **Workflow engine 取代** | AOS 是 initiator，不是 workflow engine | AOS 與 workflow-module 對等 |
| **被動 task executor 模式** | AOS 是主動 agent runtime | AOS 雖仍可接收 BPMN User Task，但非主要模式 |
| **BPMN User Task assignee 角色** | AOS 不應被視為「被派工的工人」 | 若 AOS 接收 BPMN User Task 是 initiator 啟動的子任務 |

## Relationship with Existing Surfaces

| Surface | Relationship | 互動方式 |
|---------|-------------|----------|
| `workflow-module` | **對等**（peer / initiator） | AOS 透過 Camunda 7 REST API **啟動**流程；BPMN 啟動者（starter）= AOS |
| `security-module` | 服務消費者 | AOS 使用 OAuth2 Resource Server 認證 Agent |
| `user-core-module` | 引用 | Agent User 是 User 的擴展，AOS 引用不擁有 |
| `user-organize-module` | 引用 | Agent 歸屬於組織部門 |
| `user-role-module` | 引用 | Agent 角色權限 |
| `projects/agent/` | 對等（同為 agent 相關 surface） | 既有 worker 可透過 Pi SDK 整合；AOS 是 proactive 平台，worker 是具體執行 |
| `agent-workspace/` | 不同層次 | AOS 是 product runtime；agent-workspace 是 dev-agent bootstrap |
| `agent-gateway` | 服務消費者（候選） | AOS 透過 LiteLLM proxy 呼叫 LLM（待 `aos-pi-poc` 評估 vs Pi AI 直接） |
| 各 backend module | 工具提供者 | 透過 MCP server 暴露為 AOS 工具 |

## Tech Stack（Pi SDK 拼裝式 — 零 License 風險）

> **變更說明**：`aos-runtime-tech-stack` 翻轉先前 `aos-proactive-architecture` 對 Mastra 的採用決議。**Mastra EE License 長期維護風險**與**Pi SDK 為 AOS 路徑量身打造**的評估後，改採「**Pi SDK 為核心 + OSS 工具拼裝**」策略。

| 元件 | 選型 | License | 理由 |
|------|------|---------|------|
| **語言** | TypeScript / Node.js 22+ | — | 與 Vue 3 前端、agent-gateway、agent worker 共用 |
| **AOS Runtime 核心** | **`@earendil-works/pi-agent-core`** | **MIT** | Agent class、tool calling loop、events；AOS 用 Pi Agent 為「執行單位」 |
| **LLM 抽象** | **`@earendil-works/pi-ai`** | **MIT** | 18 個 LLM providers 統一抽象（OpenAI、Anthropic、Google、Mistral、Bedrock、Azure、Cloudflare、Vertex...） |
| **MCP 整合** | **`@modelcontextprotocol/sdk`** | **MIT** | 官方 MCP SDK；AOS 為 client（呼叫 26 backend） |
| **Schedules** | **`croner`** | **MIT** | cron-like 排程 |
| **Kafka** | **`kafkajs`** | **MIT** | session event bus + 觸發源 + 跨 AOS 協作 |
| **Slack / IM** | **`@slack/bolt`** | **MIT** | Slack 觸發源 |
| **即時通訊** | **`socket.io`** | **MIT** | 跨裝置即時追蹤 SSE/WS |
| **Storage** | PostgreSQL + pgvector | PostgreSQL License | 既有 schema-registry 已用；AOS 自寫 `SessionStorage` PG impl |
| **HTTP framework** | **Fastify** + `@fastify/websocket` | **MIT** | 高效能 HTTP 框架 |
| **Audit log** | 既有 audit_event 表 + AOS 自有 schema | — | 雙軌（同步至 Beyourself 既有 audit） |
| **OpenTelemetry** | **`@opentelemetry/*`** | **Apache-2.0** | tracing、metrics（待 MVP 評估） |
| **BPMN** | 既有 workflow-module（Camunda 7 7.21.0） | — | AOS 透過 REST API 啟動流程 |

### 為什麼選 Pi SDK 而非 Mastra？

| 維度 | Pi SDK | Mastra |
|------|--------|--------|
| License | **MIT 整個 monorepo** | ⚠️ Apache-2.0 + EE 雙軌制 |
| AOS 用到的程式碼量 | **40K lines** | 63K lines |
| 依賴複雜度 | 4 deps | 28 deps |
| EE 風險 | ✅ 零 | ❌ 持續需隔離 + 監控 |
| AOS 用不到的進階功能 | 不存在 | npm tarball 內含 |

### AOS 自寫而非依賴的 Pi SDK 缺失功能

| 功能 | 自寫方式 | 工作量 |
|------|---------|--------|
| **跨裝置即時同步 session** | PG `SessionStorage` + Kafka + SSE/WS + 樂觀鎖 | 1-1.5 月 |
| **Schedules** | croner 套件 + AOS 排程表 | 1 週 |
| **Channels（Slack/IM）** | `@slack/bolt` 整合 | 2 週 |
| **Workflows（suspend/resume）** | 自寫簡化版 state machine + PG | 4 週 |
| **Multi-AOS networks** | Kafka topic 當 message bus | 2 週 |
| **長期 Memory + vector search** | pgvector + 自寫 semantic recall | 4 週 |

### 不需要的 Pi SDK 進階功能

- Pi SDK 內建 Working Memory / Observational Memory：可直接用或 AOS 自寫（看使用經驗）
- Pi SDK 內建 Compaction：AOS 直接用

### 套件完整依賴清單

詳見 `temp/aos-final-decision.md` 附錄 B（含版本號）。

## Phase 1 Scope（規劃中）

- 1 個示範 AI 員工（單一 Agent 實例）
- 3 種觸發源（cron、Kafka、人類 Slack 訊息）
- 1 個 workflow 啟動範例
- Observational Memory 基本能力
- 與 1 個 backend module 透過 MCP 整合
- Audit log 落 Beyourself 既有 audit_event 表

## Conflict Rule

若本文件與 `openspec/specs/aos-*/` 衝突，以 OpenSpec spec 為準。
若本文件與 workspace topology 文件衝突，以 topology 文件為準。
若本文件與 `aos-proactive-architecture` change 衝突，**本文件取代其技術棧決議**（Pi SDK 取代 Mastra）。
若本文件與 `aos-runtime-tech-stack` change 衝突，以 OpenSpec spec 為準（本文件同步該 change）。
