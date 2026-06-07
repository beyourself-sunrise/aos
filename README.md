# Agent Operating System (AOS)

AOS 是 Beyourself 企業系統中的 **AI 員工運行平台** — 像真人一樣**主動找事做**的獨立應用。

## 核心定位

> **AOS 是獨立應用，像真人一樣是主動找事做，而不是被 workflow 支配。**

AOS 不是另一個 BPMN worker。**AOS 與 workflow-module 對等**，且 AOS 會視需要主動**啟動**流程。

| 舊假設 | 新設計 |
|--------|--------|
| AOS 是 BPMN User Task assignee | AOS 是獨立 agent runtime |
| 觸發來源：workflow 派工 | 觸來源：**cron / Kafka / Slack / 報表 / Webhook / 同儕 AOS** |
| Session 是短任務 | Session **跨日/週**長期連續 + **跨裝置即時追蹤** |
| 與 backend 對接透過 REST | 透過 **MCP** 標準化（backend 變成 AOS 工具） |
| 與 workflow-module 上↔下 | 與 workflow-module **對等**（AOS 為 initiator） |

## 架構：自有架構 + 拼裝式 OSS

AOS 採用**自有架構 + 拼裝式 OSS 工具**策略：

- **AOS 定義自己的核心介面**（`Agent` / `SessionStorage` / `Provider` / `Trigger` / `Realtime` / `MCP` / `Audit` / `Memory`）
- 每個介面綁定 1 個輕量、MIT/Apache-2.0 的 OSS 實作
- **介面是 SSOT，實作可換**；升級某個套件不影響 AOS 業務邏輯
- **不採用任何 monolithic framework**

```
┌────────────────────────────────────────────────────────┐
│           AOS Standalone App (TypeScript)              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              AOS 介面層（SSOT）                    │  │
│  │  interface Agent / Provider / SessionStorage /   │  │
│  │  Trigger / Realtime / MCP / Audit / Memory        │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │ depends on 介面             │
│  ┌────────────────────────▼─────────────────────────┐  │
│  │              AOS 業務邏輯                          │  │
│  │  AOS Adapter / Supervisor / Identity / Audit     │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │ implements 介面             │
│  ┌────────────────────────▼─────────────────────────┐  │
│  │              AOS 實作層（OSS 綁定）               │  │
│  │  • Pi SDK (Agent + Provider 實作)                 │  │
│  │  • croner + kafkajs + @slack/bolt (Trigger)      │  │
│  │  • socket.io (Realtime)                          │  │
│  │  • @modelcontextprotocol/sdk (MCP)               │  │
│  │  • PG + Kafka (SessionStorage 實作)              │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
└────────┬─────────────────────┬──────────────────────────┘
         │                     │
         │ MCP                 │ REST
         │                     │
   ┌─────▼──────────┐    ┌─────▼──────────┐
   │ workflow-module │    │  Backend 26    │
   │ (Camunda 7)     │    │  Spring Boot   │
   │ AOS 主動啟動     │    │  MCP 工具提供者 │
   │ （非 assignee） │    │  （非 host）   │
   └────────────────┘    └────────────────┘
```

## AOS 像真實員工一樣主動找事

| 真實員工行為 | AOS 對應能力 | 實作 |
|--------------|-------------|------|
| 早上 9 點看 email / Slack | **排程觸發器** | AOS `Trigger` 介面 + `croner` |
| 看 Kanban / backlog | **Kafka 事件訂閱** | AOS `Trigger` 介面 + `kafkajs`（既有 schema-registry 27 個 schema） |
| 主管交付「分析這個」 | **Slack/IM 訊息接收** | AOS `Trigger` 介面 + `@slack/bolt` |
| 看到 deadline 接近 | **deadline 監控 + proactive notification** | 自寫輪詢 + 觸發 |
| 同事卡住幫忙 | **同儕 AOS 訊息** | Kafka topic |
| 看到報表異常開 ticket | **異常偵測 + 主動啟動 BPMN 流程** | 自寫 + 啟動 workflow |
| 1-on-1、週會 | **排程未來事件** | `croner` |
| 流程可改進提建議 | **process mining + 建議引擎** | 自寫分析 |
| 不同裝置看 agent 進度 | **跨裝置即時追蹤 Session** | AOS `SessionStorage` + `Realtime` 介面 + `socket.io` + 樂觀鎖 |

## 核心職責（10 項）

七項來自 `establish-aos-folder`，三項為 `aos-proactive-architecture` 新增：

1. **Agent Identity** — Agent User / Department / Role
2. **Agent Session（含跨裝置即時追蹤）** — AOS `SessionStorage` 介面 + PG 實作 + Kafka + `socket.io` SSE/WS + 樂觀鎖
3. **Agent Task Inbox** — 多源觸發收集（不限 BPMN）
4. **Agent Runtime** — AOS `Agent` / `Provider` 介面 + Pi SDK 實作
5. **Agent Tool Gateway** — AOS `MCP` 介面 + client/server
6. **Agent Memory** — AOS `Memory` 介面 + pgvector + 自寫 semantic recall + observational memory
7. **Agent Audit** — AOS `Audit` 介面 + OpenTelemetry + 落既有 audit_event
8. **🆕 Agent Scheduler** — AOS `Trigger.cron` 介面 + `croner`
9. **🆕 Agent Signals & Channels** — AOS `Trigger` 介面（`croner` + `kafkajs` + `@slack/bolt`）
10. **🆕 Agent Supervisor** — AOS 自寫派工邏輯 + Kafka topic 路由

## AOS 核心介面（SSOT）

| 介面 | OSS 實作 | License |
|------|----------|---------|
| `interface Agent` | `@earendil-works/pi-agent-core` | MIT |
| `interface Provider` | `@earendil-works/pi-ai` | MIT |
| `interface SessionStorage` | AOS 自寫 PG impl | 公司自有 |
| `interface Trigger` | `croner` + `kafkajs` + `@slack/bolt` | MIT |
| `interface Realtime` | `socket.io` | MIT |
| `interface MCP` | `@modelcontextprotocol/sdk` | MIT |
| `interface Audit` | `@opentelemetry/*` | Apache-2.0 |
| `interface Memory` | AOS 自寫 + pgvector | PostgreSQL License |

**核心原則**：介面在 AOS 程式碼內（`/projects/AOS/src/interfaces/`），實作可換；升級某個 OSS 套件不影響 AOS 業務邏輯。

## 跨裝置即時追蹤 Session — 核心能力

> **「隨時隨地、不同設備接到同一個 session，都可以即時追蹤」**

AOS 必須支援（既有 OSS agent framework 皆不提供，AOS 自寫介面與實作）：

| 子能力 | 實作 | 工作量 |
|--------|------|--------|
| A. Session 持久化 | AOS `SessionStorage` 介面 → PG 實作 | 5-8 人天 |
| B. 多裝置讀取 | 透過 `aos_session` 表 + `session_id` 查詢 | 1 週內 |
| C. 跨裝置即時事件推送 | Kafka publish + `socket.io` SSE/WS | 2-3 週 |
| D. 衝突處理 | PG 樂觀鎖 + retry pattern | 1-2 週 |

**完整設計**（PG schema、SSE API 規格、樂觀鎖實作）見 `openspec/changes/aos-runtime-tech-stack/refs/aos-final-decision.md` §6。

## 技術棧（AOS 自有架構 + 拼裝式 OSS）

| 層 | 選型 | License |
|---|------|---------|
| 語言 | **TypeScript / Node.js 22+** | — |
| AOS 介面層 | **AOS 自有**（TypeScript `interface`） | 公司自有 |
| AOS 業務邏輯 | **AOS 自有**（AOS Adapter / Supervisor / Identity / Audit） | 公司自有 |
| `Agent` 介面實作 | **`@earendil-works/pi-agent-core`** | **MIT** |
| `Provider` 介面實作 | **`@earendil-works/pi-ai`**（18 providers） | **MIT** |
| `MCP` 介面實作 | **`@modelcontextprotocol/sdk`** | **MIT** |
| `Trigger` 介面實作 | **`croner`** + **`kafkajs`** + **`@slack/bolt`** | **MIT** |
| `Realtime` 介面實作 | **`socket.io`** | **MIT** |
| `Audit` 介面實作 | **`@opentelemetry/*`** | **Apache-2.0** |
| HTTP framework | **Fastify** + `@fastify/websocket` | **MIT** |
| Storage | PostgreSQL + pgvector | PostgreSQL License |
| BPMN 互動 | **Camunda 7 REST** | — |
| LLM 統一入口 | 候選：`agent-gateway` (LiteLLM) 或 `Provider` 介面直接 | — |

**完整依賴清單**（含版本號）見 `openspec/changes/aos-runtime-tech-stack/refs/aos-final-decision.md` 附錄 B。

## 為何 AOS 不採用 monolithic framework

AOS 自有架構（拼裝式）vs 採用 monolithic framework：

| 維度 | AOS 自有架構 | Monolithic framework |
|------|--------------|---------------------|
| **業務耦合** | AOS 介面是 SSOT；業務不耦合特定 SDK | 框架預設的 Workflows/Channels/Networks 對 AOS 業務 over-spec |
| **License 風險** | 嚴格篩選 MIT/Apache-2.0/PostgreSQL | 部分 framework 含 EE / 雙軌制子路徑 |
| **依賴複雜度** | 每個套件單一職責 | 28+ 個 transitive deps |
| **升級影響** | 介面不變，換實作 | 框架升級可能 breaking AOS 業務邏輯 |

**AOS License 政策**：所有依賴僅 MIT / Apache-2.0 / PostgreSQL License。CI 跑 `npx license-checker --production --csv` 自動驗證。

## AOS 不取代、不擁有

- ❌ BPMN 工作流引擎（歸 workflow-module）
- ❌ ERP 業務邏輯（歸各 domain module）
- ❌ HR 真相資料（歸 user-attendance / user-payroll）
- ❌ auth/authz（歸 security-module）
- ❌ User/Org/Role master data（歸 user-* / organize-module / role-module）
- ❌ dev-agent bootstrap（歸 agent-workspace）
- ❌ Coding agent runtime（歸 Claude Code / Codex / Pi 等）
- ❌ **被動 task executor 模式**（AOS 是主動 agent）
- ❌ **採用 monolithic framework**（AOS 是自有架構）

## 當前狀態

> 完整 roadmap / 依賴 DAG / 時間軸詳見 [ROADMAP.md](./ROADMAP.md)（SSOT）。

| Phase | Change | 狀態 |
|-------|--------|------|
| Phase 0 | `establish-aos-folder` | ✅ Done |
| Phase 1a | `aos-proactive-architecture` | ✅ Done |
| Phase 1b | `aos-runtime-tech-stack` + cleanup + shared memory | ✅ Done |
| **Phase 2** | `aos-poc` | 🟡 **Scaffolded — 待實作** |

**下一步**：`aos-poc` 開始實作（2 週工作量；9 個 verification step 詳見 [ROADMAP.md](./ROADMAP.md)）。

## 文件

- [ROADMAP.md](./ROADMAP.md) — 開發順序 SSOT（9 個 change + 依賴 DAG + 時間軸）
- [RESPONSIBILITY.md](./RESPONSIBILITY.md) — 職責邊界（SSOT）
- `openspec/changes/aos-runtime-tech-stack/` — 技術棧策略 change（含 `refs/aos-final-decision.md` 完整決議版）
- `openspec/changes/aos-proactive-architecture/` — 設計哲學翻轉 change
- `openspec/changes/aos-poc/` — 端到端 POC change
- `openspec/changes/establish-aos-folder/` — 命名空間建立 change
- `openspec/specs/aos-*/` — 規範性需求（後續開）

## 相關模組

- [workflow-module](../backend/module/workflow-module/) — BPMN 工作流（對等）
- [security-module](../backend/module/security-module/) — 認證授權
- [user-core-module](../backend/module/user-core-module/) — 使用者管理
- [user-organize-module](../backend/module/user-organize-module/) — 組織管理
- [user-role-module](../backend/module/user-role-module/) — 角色權限
- [agent-gateway](../backend/agent-gateway/) — LLM proxy（候選整合）
- [projects/agent/](../agent/) — 既有 agent worker（對等 surface）
- [agent-workspace](../../agent-workspace/) — 開發 agent bootstrap
