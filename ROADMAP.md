# AOS Roadmap — 開發順序 SSOT

> **Single Source of Truth**：AOS 開發順序、依賴關係、當前狀態、時間軸的唯一真相。
>
> 任何 AOS 相關的 roadmap / 排程 / 階段劃分，**都以此檔為準**。本檔不在 `openspec/changes/<X>/` 內（不是 single change scope），不在 `temp/` 內（不是臨時文件），不在 `docs/architecture/` 內（不是 workspace topology）— 是 `projects/AOS/` 自己的 AOS-level roadmap。

## 當前狀態（截至 2026-06-07，PR #1170）

| Phase | Change | PR | 狀態 |
|-------|--------|-----|------|
| Phase 0 | `establish-aos-folder` | #1160 | ✅ Done |
| Phase 1a | `aos-proactive-architecture` | #1162 | ✅ Done |
| Phase 1b | `aos-runtime-tech-stack` | #1163 + #1164 | ✅ Done |
| Phase 1b-cleanup | `aos-proactive-architecture` Supersession Notice | #1166 + #1167 | ✅ Done |
| Phase 1b-docs | AOS 設計哲學 + 自有架構 shared memory | #1169 | ✅ Done |
| **Phase 2** | **`aos-poc`（scaffold）** | **#1170** | 🟡 **Scaffolded — 42 tasks pending** |

**下一步可開工**：`aos-poc` 開始實作介面 + adapters + 整合測試（2 週工作量）。

---

## 9 個 OpenSpec Change 路線圖（P0/P1/P2）

> 排序原則：**P0 是「不做 AOS 就不可用」的最低集合**；P1 是「production-ready 必備」；P2 是「進階功能」。每個 change 完成才進入下一個；不平行。

### P0 — AOS 最低可用（2.5-3 月工作量）

| Change | 工作量 | 啟動條件 | 成功標準 |
|--------|--------|----------|----------|
| **`aos-poc`** | 2 週 | 無（立刻可開工） | docker compose up 跑得起來；cron 觸發 → Agent 跑 → MCP 工具呼叫 → BPMN 啟動；既有 26 backend 零變更 |
| **`aos-pg-session-storage`** | 3 週 | `aos-poc` 完成 | `SessionStorage` 介面 PG 實作（含樂觀鎖 `version` 欄位 + `SELECT FOR UPDATE`）；migration 腳本；單元 + 整合測試 |
| **`aos-cross-device-session-realtime`** | 1-1.5 月 | `aos-poc` + `aos-pg-session-storage` 完成 | 5 元件實作（`PgSessionStorage` / `SessionEventBus` / `RealTimeStreamService` / `ConflictResolver` / `SubscriptionRegistry`）；SSE/WS 推播；多裝置同步測試 |

**為何 P0**：
- `aos-poc` — 沒有 POC 驗證，後續 change 都在沙上城堡
- `aos-pg-session-storage` — 沒有持久化，AOS 跨日重啟就掉 session
- `aos-cross-device-session-realtime` — AOS 核心競爭力；真人類員工不會「在公司看 AOS，回家就斷線」

### P1 — Production-ready（3-4 月工作量）

| Change | 工作量 | 啟動條件 | 成功標準 |
|--------|--------|----------|----------|
| **`aos-mcp-tools-bridge`** | 3 週 | `aos-poc` 完成 | 26 backend module 全量 MCP 化（per-module MCP server 或共用 gateway，待 spec 確認）；tool schema 註冊；整合測試 |
| **`aos-triggers`** | 4 週 | `aos-poc` 完成 | `Trigger` 介面 Kafka / Slack / 報表 / Webhook 實作；`croner` 已在 `aos-poc` 內；4 種觸發源整合測試 |
| **`aos-mvp`** | 2 月 | P0 + P1 全部完成 | 多 Agent 實例、Observational Memory（v1）、Workflows（v1）、完整 audit log；10 user persona 案例 |

**為何 P1**：
- `aos-mcp-tools-bridge` — 沒有 MCP 化，backend module 無法被 AOS 呼叫
- `aos-triggers` — 沒有 Kafka/Slack 觸發，AOS 只是 cron runner 不是 proactive
- `aos-mvp` — AOS 完整 production-ready 必備

### P2 — 進階（2.5-3 月工作量）

| Change | 工作量 | 啟動條件 | 成功標準 |
|--------|--------|----------|----------|
| **`aos-workflows`** | 4 週 | `aos-mvp` 完成 | 簡化版 state machine（suspend/resume）；可被 AOS 自身 lifecycle 使用 |
| **`aos-observational-memory`** | 4 週 | `aos-mvp` 完成 | `Memory` 介面 + pgvector；自動從 session 萃取 observation；語意檢索測試 |
| **`aos-multi-aos-networks`** | 2 週 | `aos-mvp` 完成 | 多 AOS 協作（leader election / 訊息 routing / 失敗重試 / escalation）；Kafka topic routing |

**為何 P2**：
- 進階功能；不影響 AOS 最低可用
- 可以晚於 MVP 數月才開工

---

## 依賴 DAG

```
[Done] Phase 0/1a/1b
        ↓
   aos-poc (P0) ─────────────────────────┐
        │                                  │
        ├─→ aos-pg-session-storage (P0)    │
        │                                  │
        ├─→ aos-mcp-tools-bridge (P1)      │
        │                                  │
        ├─→ aos-triggers (P1)              │
        │                                  │
        └─→ aos-cross-device-session-realtime (P0)
                │                          │
                └─→ aos-mvp (P1) ←─────────┘
                        │
                        ├─→ aos-workflows (P2)
                        ├─→ aos-observational-memory (P2)
                        └─→ aos-multi-aos-networks (P2)
```

**關鍵路徑**：
- `aos-poc`（2 週）
- → `aos-pg-session-storage`（3 週）
- → `aos-cross-device-session-realtime`（1.5 月）
- → `aos-mvp`（2 月）
- = **~4 月到 MVP**

**非關鍵路徑**（可平行）：
- `aos-mcp-tools-bridge`（3 週）— 在 `aos-poc` 完成後可獨立於 `aos-pg-session-storage` 開工
- `aos-triggers`（4 週）— 在 `aos-poc` 完成後可獨立開工

**P2** 三個 change 都依賴 `aos-mvp`；彼此獨立可平行。

---

## 時間軸（規劃 vs 實際）

| 期間 | Phase | 規劃交付 | 實際 |
|------|-------|----------|------|
| 2026-06 上 | Phase 1b | — | 5 個 PR 合併：#1160 / #1162 / #1163 / #1164 + cleanup |
| 2026-06 下 | Phase 2 起 | `aos-poc` 開工 | `aos-poc` scaffold 已合併（#1170） |
| 2026-07 | Phase 2 | `aos-poc` 完成（2 週） | 待實作 |
| 2026-07~08 | Phase 3a | `aos-pg-session-storage` + `aos-cross-device-session-realtime` 開工 | 待 Phase 2 完成 |
| 2026-08~09 | Phase 3b | `aos-mcp-tools-bridge` + `aos-triggers` 開工（可平行） | 待 Phase 3a 開始後 |
| 2026-09~11 | Phase 3c | `aos-mvp` 開工（依賴 P0 + P1 全部） | 待 Phase 3b 完成 |
| 2026-11~2027-01 | Phase 4 | P2 三個 change（可平行） | 待 `aos-mvp` 完成 |

**最早可達 MVP**：2026-11（依賴關鍵路徑全部依時完成）

**風險排程**：
- `aos-cross-device-session-realtime` 是最複雜 P0 change（5 元件 + 分散式系統問題）
- `aos-mvp` 是最大 P1 change（依賴最多）
- `aos-multi-aos-networks` 目標模糊（spec 待補）

---

## 同步規則

**本檔是 SSOT**。其他文件描述 AOS 開發順序時，**必須引用本檔**，不能各自重寫。

### 必須引用本檔的文件

| 文件 | 引用方式 |
|------|----------|
| `projects/AOS/README.md` 「當前狀態」段 | 引用本檔「當前狀態」表；不重複列 phase 細節 |
| `projects/AOS/RESPONSIBILITY.md` 「Phase Scope」段 | 引用本檔「P0/P1/P2」表；不重複列時程 |
| `openspec/changes/aos-poc/tasks.md` §4 Backlog | 引用本檔「9 個 change 路線圖」表；不重複列時程 |
| `openspec/changes/aos-runtime-tech-stack/refs/aos-final-decision.md` 附錄 C | 引用本檔；標示「已搬到 ROADMAP.md」 |
| `temp/aos-final-decision.md` 附錄 C | 同上 |

### 不可寫 roadmap 的文件

- ❌ 各 `change-explainer.html` 內的「路線圖」段：引用本檔，不重寫
- ❌ 各 `change/proposal.md` 的「Relationship to Previous Changes」段：列出 1-2 個緊鄰依賴即可，不列完整 9-change roadmap
- ❌ 任何 shared memory 條目：只列當下事實，不列未來排程

---

## 更新流程

本檔更新 MUST 走 worktree pipeline（multi-file edit）：

1. 開 worktree（`docs-aos-roadmap-update` 或類似 slug）
2. 改 `projects/AOS/ROADMAP.md` + 同步各個引用文件
3. 跑驗證：`check-archive-readiness.sh aos-*`（不應破壞既有 change）
4. `agent-finish.sh <slug> --auto-merge`（已 approved direction）
5. 更新 `verified_at` 日期在 frontmatter

### Frontmatter

```yaml
---
name: AOS Roadmap SSOT
description: 9 個 OpenSpec change 開發順序的 single source of truth；包含當前狀態、依賴 DAG、時間軸
type: project
originSessionId: aos-roadmap-ssot-2026-06-07
scope: aos
verified_at: 2026-06-07
source: human:shawn
---
```

---

## 配套文件

- `projects/AOS/RESPONSIBILITY.md` — AOS 職責邊界（**不變式**）
- `projects/AOS/README.md` — AOS 入門（**架構總覽**）
- `openspec/changes/aos-runtime-tech-stack/refs/aos-final-decision.md` — 技術棧決策完整紀錄（**歷史決策**）
- `knowledge/shared-memory/workspace/aos-proactive-design-philosophy.md` — 主動設計哲學（**不變式**）
- `knowledge/shared-memory/workspace/aos-self-arch-strategy.md` — 自有架構 + 拼裝式 OSS 策略（**不變式**）

本檔 = 排程 / 進度
RESPONSIBILITY.md = 職責 / 邊界
README.md = 架構 / 概覽
shared-memory = 不變式 / 慣例
