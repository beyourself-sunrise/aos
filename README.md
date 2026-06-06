# Agent Operating System (AOS)

AOS 是 Beyourself 企業系統中的 **AI 員工運行平台** — 像真人一樣**主動找事做**的獨立應用。

## 核心定位

> **AOS 是獨立應用，像真人一樣是主動找事做，而不是被 workflow 支配。**

AOS 不是另一個 BPMN worker。**AOS 與 workflow-module 對等**，且 AOS 會視需要主動**啟動**流程。

| 舊假設 | 新設計 |
|--------|--------|
| AOS 是 BPMN User Task assignee | AOS 是獨立 agent runtime |
| 觸發來源：workflow 派工 | 觸來源：**cron / Kafka / Slack / 報表 / Webhook / 同儕 AOS** |
| Session 是短任務 | Session **跨日/週**長期連續 |
| 與 backend 對接透過 REST | 透過 **MCP** 標準化（backend 變成 AOS 工具） |
| 與 workflow-module 上↔下 | 與 workflow-module **對等**（AOS 為 initiator） |

## 架構

```
┌────────────────────────────────────────────────────────┐
│           AOS Standalone App (Mastra/TypeScript)       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Mastra Runtime                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │  │
│  │  │Supervisor │  │Background│  │   Networks   │    │  │
│  │  │ Agent     │  │  Tasks   │  │ (multi-AOS)  │    │  │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │  │
│  │       │             │              │              │  │
│  │  ┌────▼─────────────▼──────────────▼───────────┐  │  │
│  │  │  Schedules · Signals · Channels              │  │  │
│  │  │  cron · Kafka · Slack · REST · Webhook       │  │  │
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

| 真實員工行為 | AOS 對應能力 |
|--------------|-------------|
| 早上 9 點看 email / Slack | **排程觸發器**（Mastra `Schedules`） |
| 看 Kanban / backlog | **Kafka 事件訂閱**（既有 schema-registry 27 個 schema） |
| 主管交付「分析這個」 | **Slack/IM 訊息接收**（Mastra `Channels`） |
| 看到 deadline 接近 | **deadline 監控 + proactive notification** |
| 同事卡住幫忙 | **同儕 AOS 訊息**（Mastra `Networks`） |
| 看到報表異常開 ticket | **異常偵測 + 主動啟動 BPMN 流程** |
| 1-on-1、週會 | **排程未來事件** |
| 流程可改進提建議 | **process mining + 建議引擎** |

## 核心職責（10 項）

七項來自 `establish-aos-folder`，三項為本次 pivot 新增：

1. **Agent Identity** — Agent User / Department / Role
2. **Agent Session** — 長期連續性、suspend/resume、context compaction
3. **Agent Task Inbox** — 多源觸發收集（不限 BPMN）
4. **Agent Runtime** — Mastra-based LLM 編排、tool calling loop
5. **Agent Tool Gateway** — MCP client + server
6. **Agent Memory** — Observational + Working + Semantic recall
7. **Agent Audit** — 完整操作審計（含主動觸發的判斷依據）
8. **🆕 Agent Scheduler** — 內建 cron 排程（🔄 本次 pivot 新增）
9. **🆕 Agent Signals & Channels** — 多源觸發（cron/Kafka/Slack/報表/Webhook/同儕）🔄
10. **🆕 Agent Supervisor** — 多 AOS 派工、協作、escalation（🔄）

## 技術棧

| 層 | 選型 | 備註 |
|---|------|------|
| 語言 | **TypeScript / Node.js 22+** | 與 Vue 3、agent-gateway、agent worker 共用 |
| AOS Runtime | **Mastra** | 完整對應 proactive agent 需求 |
| Storage | **PostgreSQL + pgvector** | 既有 schema-registry |
| BPMN 互動 | **Camunda 7 REST** | 既有 workflow-module |
| LLM 呼叫 | `agent-gateway` (LiteLLM) 或 Mastra 內建 | 評估中 |
| Audit | 既有 `audit_event` 表 + AOS 自有 schema | 雙軌 |

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

**Phase 0**：命名空間 + 設計哲學翻轉（本次 change 完成）  
**Phase 1**：Mastra + 多源觸發 + 1 個示範 AI 員工 + 1 個 BPMN 啟動範例

## 文件

- [RESPONSIBILITY.md](./RESPONSIBILITY.md) — 職責邊界（SSOT）
- `openspec/changes/aos-proactive-architecture/` — 本次 design pivot change
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
