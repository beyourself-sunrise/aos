# projects/AOS Responsibility

## Role

`projects/AOS/` 是 Agent Operating System（AOS）的 workspace 命名空間。

AOS 是企業中的 **AI 員工運行平台**，讓 AI Agent 成為組織正式成員，
與人類員工共存於同一企業系統（BPMN、ERP、HR）中。

AOS 不取代 BPMN、不取代 ERP、不取代 HR。它是與這些系統平行的
AI 員工運行層。

## Owns

AOS 擁有以下七項核心職責領域：

### 1. Agent Identity
Agent 作為系統使用者存在。
- Agent User（AI 員工帳號）
- Agent Department（組織歸屬）
- Agent Role（角色權限）

AOS 引用但不擁有 user/org/role master data（歸 user-core-module、
user-organize-module、user-role-module 所有）。

### 2. Agent Session
Session 屬於 Agent，為 Agent 的工作上下文。
- Agent 工作階段管理
- Agent 上下文狀態
- Session 生命週期

第一階段不追求跨 Agent Session 接管。

### 3. Agent Task Inbox
Agent 接收並管理來自多個來源的任務：
- BPMN User Task（來自 workflow-module）
- 系統任務
- 人工指派任務

AOS 引用但不擁有 Task 定義與流程狀態（歸 workflow-module 所有）。

### 4. Agent Runtime
Agent 執行任務的運行環境：
- 接收任務
- 理解任務（LLM-powered）
- 呼叫工具
- 完成任務並回報結果

### 5. Agent Tool Gateway
統一管理 Agent 可用的系統能力：
- REST API 代理（呼叫 backend module API）
- MCP（Model Context Protocol）工具
- 系統能力註冊與發現

Agent 不直接操作資料庫，必須透過 Tool Gateway 執行工作。

### 6. Agent Memory
Agent 的工作記憶與長期知識：
- 短期工作上下文
- 長期記憶儲存
- 記憶檢索

### 7. Agent Audit
完整記錄 Agent 所有行為：
- 任務接收與完成
- 工具呼叫（含參數與結果）
- 決策過程
- 資料查看與修改
- 流程參與

所有操作皆可追溯、可審計。

### 附加：Agent Policy
跨領域的 Agent 治理規則（行為邊界、權限限制、合規要求）。
Policy 定義可能落在 `openspec/specs/aos-*/` 下作為規範性要求，
不一定是 AOS 的獨立執行期子元件。

## Does Not Own

- **BPMN 工作流引擎** — 歸 workflow-module 所有。AOS 參與工作流（作為 Task assignee），
  但不擁有流程定義、Task 生命週期或 BPMN 執行。
- **ERP 業務邏輯** — 歸各 domain module（inventory、procurement、manufacturing、
  sales 等）所有。AOS 透過 Tool Gateway 呼叫這些模組的 API，但不實作業務規則。
- **HR 真相資料** — 歸 user-attendance-module、user-payroll-module 所有。
  AOS 不擁有出勤記錄或薪資計算。
- **認證與授權** — 歸 security-module 所有。AOS 使用 security-module 的
  auth/authz 機制，但不實作自己的認證系統。
- **User / Organization / Role master data** — 分別歸 user-core-module、
  user-organize-module、user-role-module 所有。AOS 的 Agent Identity 是
  對這些 master data 的擴展應用，而非替代。
- **開發 Agent bootstrap** — 歸 `agent-workspace/` 所有。`projects/AOS/`
  是 product/runtime 平台，不是開發輔助工具（類似 `projects/agent/` 與
  `agent-workspace/` 的分工）。
- **Agent 執行實作（worker lines）** — 歸 `projects/agent/` 下各 worker 所有。
  AOS 提供 AI 員工的平台框架；具體的 Temporal worker 等執行實作仍屬
  `projects/agent/`。

## Placement Rules

- AOS 平台層的程式碼與設定放在 `projects/AOS/` 下。
- AOS 平台的規範性需求（specs）放在 `openspec/specs/aos-*/` 下。
- AOS 的子元件（如 identity、runtime、gateway 等）放在 `projects/AOS/<component>/` 下。
- AOS 與 workflow-module 的互動契約放在 `openspec/specs/` 下（跨模組 spec）。
- AOS 治理規則（Agent Policy）放在 `openspec/specs/aos-policy/` 下。

## Relationship with Existing Surfaces

| Surface | Relationship |
|---------|-------------|
| `workflow-module` | AOS 作為 BPMN User Task 的 assignee，接收並完成任務 |
| `security-module` | AOS 使用 security-module 進行 Agent 認證與授權 |
| `user-core-module` | AOS 的 Agent User 是 user-core-module User 的擴展 |
| `user-organize-module` | AOS Agent 歸屬於組織部門 |
| `user-role-module` | AOS Agent 擁有角色與對應權限 |
| `projects/agent/` | AOS 是平台框架；`projects/agent/` 是具體 worker 執行實作 |
| `agent-workspace/` | AOS 是 product runtime；`agent-workspace/` 是 dev-agent bootstrap |

## Conflict Rule

若本文件與 `openspec/specs/aos-*/` 衝突，以 OpenSpec spec 為準。
若本文件與 workspace topology 文件衝突，以 topology 文件為準。
