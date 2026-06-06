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

## 架構

```
┌────────────────────────────────────────────────────────┐
│           AOS Standalone App (TypeScript/Pi SDK)        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              AOS Adapter (長程管理者)              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │  │
│  │  │Supervisor │  │Schedules │  │  Signals     │    │  │
│  │  │ Agent     │  │(croner)  │  │ Channels     │    │  │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │  │
│  │       │             │              │              │  │
│  │  ┌────▼─────────────▼──────────────▼───────────┐  │  │
│  │  │  Real-time Hub                                │  │  │
│  │  │  Kafka event bus + SSE/WS + Subscription     │  │  │
│  │  └─────────────────┬───────────────────────────┘  │  │
│  │                     │                              │  │
│  │  ┌──────────────────▼──────────────────────────┐  │  │
│  │  │  Pi Agent instances (執行單位)                │  │  │
│  │  │  (Pi SDK + Pi AI)                             │  │  │
│  │  └─────────────────┬───────────────────────────┘  │  │
│  │                     │                              │  │
│  │  ┌──────────────────▼──────────────────────────┐  │  │
│  │  │  Tool Gateway (MCP client + server)           │  │  │
│  │  │  + Observational Memory + Audit              │  │  │
│  │  └─────────────────┬───────────────────────────┘  │  │
│  └────────────────────┼─────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼─────────────────────────────┐  │
│  │  Storage: PostgreSQL + pgvector                    │  │
│  │  identity · session · memory · audit_log           │  │
│  │  + SessionStorage (PG impl, 樂觀鎖)              │  │
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
| 早上 9 點看 email / Slack | **排程觸發器** | `croner` + AOS Scheduler |
| 看 Kanban / backlog | **Kafka 事件訂閱** | `kafkajs` + 既有 schema-registry 27 個 schema |
| 主管交付「分析這個」 | **Slack/IM 訊息接收** | `@slack/bolt` |
| 看到 deadline 接近 | **deadline 監控 + proactive notification** | 自寫輪詢 + 觸發 |
| 同事卡住幫忙 | **同儕 AOS 訊息** | Kafka topic `aos.peer.{id}` |
| 看到報表異常開 ticket | **異常偵測 + 主動啟動 BPMN 流程** | 自寫 + 啟動 workflow |
| 1-on-1、週會 | **排程未來事件** | `croner` |
| 流程可改進提建議 | **process mining + 建議引擎** | 自寫分析 |
| 不同裝置看 agent 進度 | **跨裝置即時追蹤 Session** | `socket.io` + PG `SessionStorage` + 樂觀鎖 |

## 核心職責（10 項）

七項來自 `establish-aos-folder`，三項為 `aos-proactive-architecture` 新增：

1. **Agent Identity** — Agent User / Department / Role
2. **Agent Session（含跨裝置即時追蹤）** — PG `SessionStorage` + Kafka + SSE/WS + 樂觀鎖；跨裝置訂閱同一 session
3. **Agent Task Inbox** — 多源觸發收集（不限 BPMN）
4. **Agent Runtime（Pi SDK）** — `@earendil-works/pi-agent-core` + `pi-ai`；AOS Adapter 包裝 Pi Agent 為執行單位
5. **Agent Tool Gateway** — MCP client + server（`@modelcontextprotocol/sdk`）
6. **Agent Memory** — pgvector + 自寫 semantic recall + observational memory
7. **Agent Audit** — 完整操作審計（含主動觸發的判斷依據；落既有 audit_event）
8. **🆕 Agent Scheduler** — `croner` 內建 cron 排程
9. **🆕 Agent Signals & Channels** — 多源觸發（`croner` + `kafkajs` + `@slack/bolt`）
10. **🆕 Agent Supervisor** — 多 AOS 派工、協作、escalation（Kafka topic 路由）

## 跨裝置即時追蹤 Session — 核心能力

> **「隨時隨地、不同設備接到同一個 session，都可以即時追蹤」**

AOS 必須支援（既有 OSS agent framework 皆不提供，AOS 自寫）：

| 子能力 | 實作 | 工作量 |
|--------|------|--------|
| A. Session 持久化 | Pi `SessionStorage` 介面 → PG 實作 | 5-8 人天 |
| B. 多裝置讀取 | 透過 `aos_session` 表 + `session_id` 查詢 | 1 週內 |
| C. 跨裝置即時事件推送 | Kafka publish + socket.io SSE/WS | 2-3 週 |
| D. 衝突處理 | PG 樂觀鎖 + retry pattern | 1-2 週 |

**完整設計**（PG schema、SSE API 規格、樂觀鎖實作）見 `temp/aos-final-decision.md` §6。

## 技術棧（Pi SDK 拼裝式 — 零 License 風險）

> **變更**：`aos-runtime-tech-stack` 翻轉先前 `aos-proactive-architecture` 對 Mastra 的採用，改採「**Pi SDK + OSS 工具拼裝**」。

| 層 | 選型 | License |
|---|------|---------|
| 語言 | **TypeScript / Node.js 22+** | — |
| AOS Runtime 核心 | **`@earendil-works/pi-agent-core`** 0.78.1 | **MIT** |
| LLM 抽象 | **`@earendil-works/pi-ai`** 0.78.1（18 個 providers） | **MIT** |
| MCP | **`@modelcontextprotocol/sdk`** 1.29.0 | **MIT** |
| 排程 | **`croner`** 10.x | **MIT** |
| Kafka | **`kafkajs`** 2.x | **MIT** |
| Slack / IM | **`@slack/bolt`** | **MIT** |
| 即時通訊 | **`socket.io`** 4.x | **MIT** |
| HTTP framework | **Fastify** + `@fastify/websocket` | **MIT** |
| Storage | PostgreSQL + pgvector | PostgreSQL License |
| Observability | **`@opentelemetry/*`** | **Apache-2.0** |
| BPMN 互動 | **Camunda 7 REST** | — |
| LLM 統一入口 | 候選：`agent-gateway` (LiteLLM) 或 Pi AI 直接 | — |

**完整依賴清單**（含版本號）見 `temp/aos-final-decision.md` 附錄 B。

## 為什麼選 Pi SDK 而非 Mastra？

| 維度 | Pi SDK | Mastra |
|------|--------|--------|
| License | **MIT 整個 monorepo** | ⚠️ Apache-2.0 + EE 雙軌制 |
| AOS 用到的程式碼量 | 40K lines | 63K lines |
| 依賴複雜度 | 4 deps | 28 deps |
| EE 風險 | ✅ 零 | ❌ 持續需隔離 + 監控 |
| AOS 用不到的進階功能 | 不存在 | npm tarball 內含 |
| 設計原點 | Agent runtime 本位 | 完整 agent framework |

**關鍵決策**：AOS 自寫缺失功能（4-6 月工作量）< Mastra EE 隔離維護成本 → 長期 TCO Pi SDK 勝出。

## AOS 不取代、不擁有

- ❌ BPMN 工作流引擎（歸 workflow-module）
- ❌ ERP 業務邏輯（歸各 domain module）
- ❌ HR 真相資料（歸 user-attendance / user-payroll）
- ❌ auth/authz（歸 security-module）
- ❌ User/Org/Role master data（歸 user-* / organize-module / role-module）
- ❌ dev-agent bootstrap（歸 agent-workspace）
- ❌ Coding agent runtime（歸 Claude Code / Codex / Pi 等）
- ❌ **被動 task executor 模式**（AOS 是主動 agent）

## 當前狀態

**Phase 0**：命名空間（`establish-aos-folder`，PR #1160） ✅  
**Phase 1a**：設計哲學翻轉（`aos-proactive-architecture`，PR #1162） ✅  
**Phase 1b**：技術棧翻轉為 Pi SDK（`aos-runtime-tech-stack`，本 README 反映） 🔄  
**Phase 2**：POC + 跨裝置設計（`aos-pi-poc` + `aos-cross-device-session-realtime`，2 週 + 1.5 月）  
**Phase 3**：MVP（`aos-mvp` + Storage + MCP bridge + Triggers，2-3 月）  
**Phase 4**：進階（Workflows + Observational Memory + Multi-AOS Networks，3-4 月）

## 文件

- [RESPONSIBILITY.md](./RESPONSIBILITY.md) — 職責邊界（SSOT）
- `openspec/changes/aos-runtime-tech-stack/` — 本次技術棧翻轉 change
- `openspec/changes/aos-proactive-architecture/` — 設計哲學翻轉 change
- `openspec/changes/establish-aos-folder/` — 命名空間建立 change
- `temp/aos-final-decision.md` — 完整決議版紀錄（34 KB / 773 行）
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
