# Agent Operating System (AOS)

AOS 是 Beyourself 企業系統中的 **AI 員工運行平台**。

## 定位

AOS 讓 AI Agent 成為組織中的正式成員，與人類員工共存於同一企業系統中。
AI Agent 不是外部工具，而是擁有身份、組織歸屬、角色權限的數位員工。

```
Enterprise System
├─ BPMN Workflow    (workflow-module)
├─ ERP Services     (各 domain module)
├─ HR Services      (user-* modules)
└─ Agent OS         (projects/AOS/)
   ├─ Agent Identity
   ├─ Agent Session
   ├─ Agent Task Inbox
   ├─ Agent Runtime
   ├─ Agent Tool Gateway
   ├─ Agent Memory
   └─ Agent Audit
```

## 核心設計理念

- **AI Agent 是員工**，不是工具
- **Session 屬於 Agent**，不是人類使用者
- **Agent 透過系統能力工作**（API、BPMN、Tool Gateway），不直接操作資料庫
- **所有操作可審計**，留下完整紀錄

## 第一階段目標

建立 AI 員工最小可行架構（MVP）：

1. **Agent Identity** — AI 員工帳號、部門歸屬、角色權限
2. **Agent Task Inbox** — 接收 BPMN User Task 與其他任務
3. **Agent Runtime** — 理解並執行任務
4. **Agent Tool Gateway** — 統一呼叫系統 API 與工具
5. **Agent Audit** — 完整操作審計紀錄

## 當前狀態

**Phase 0** — 命名空間與職責邊界定義完成。
實作尚未開始。

## 文件

- [RESPONSIBILITY.md](./RESPONSIBILITY.md) — 職責邊界（SSOT）
- `openspec/specs/aos-platform/` — 平台規範（待建立）
- `openspec/changes/establish-aos-folder/` — 本命名空間建立 change

## 相關模組

- [workflow-module](../backend/module/workflow-module/) — BPMN 工作流
- [security-module](../backend/module/security-module/) — 認證授權
- [user-core-module](../backend/module/user-core-module/) — 使用者管理
- [user-organize-module](../backend/module/user-organize-module/) — 組織管理
- [user-role-module](../backend/module/user-role-module/) — 角色權限
