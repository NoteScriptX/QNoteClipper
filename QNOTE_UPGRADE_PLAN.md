# QNote Clipper 开发计划与现状

> 本文件记录 QNote Clipper 浏览器插件按 Phase 推进的开发状态。
> 真实源码优先于历史文档；后端能力以 QNoteServer/QTable 源码为准。

## 技术栈

**内部试用版本**: `0.1.0`

| 维度 | 现状 |
|------|------|
| 构建 | Plasmo v0.90.5（chrome-mv3） |
| 前端 | React 18 + TypeScript 5.3 |
| 样式 | TailwindCSS 3 + Radix Dialog |
| 存储 | `chrome.storage.local`（`nsx_annotations_v1`）+ 同步队列 |
| 认证 | 密码登录 → QNote `/api/clipper/session` → 共享 JWT + 自动刷新 |
| 通信 | `chrome.runtime` 消息 + `chrome.storage.onChanged` 广播 |
| 后端 | QNoteServer（FastAPI + Strawberry GraphQL，端口 9001） |

## 脚本命令

| 命令 | 状态 |
|------|------|
| `pnpm dev` | ✅ 存在 |
| `pnpm build` | ✅ 存在（已通过） |
| `pnpm package` | ✅ 存在 |
| `pnpm typecheck` | ❌ 不存在（用 `npx tsc --noEmit`，已通过） |
| `pnpm lint` | ❌ 不存在 |
| `pnpm test` | ❌ 不存在（无测试脚本） |

---

## Phase 0 — 基础能力

- [x] Plasmo + TS + React 工程骨架
- [x] `chrome.storage.local` 持久化 + 软删除 tombstone
- [x] Typed Messaging 基础（`utils/messaging.ts`）
- [x] Side Panel（`sidepanel.tsx`）
- [x] Background Service Worker（`background.ts`）
- [x] 认证（`utils/auth.ts`：`/api/clipper/session`、`/session/refresh`、`/auth/me`）

**Files**: `package.json`、`utils/storage.ts`、`utils/messaging.ts`、`utils/auth.ts`、`utils/settings.ts`、`background.ts`、`sidepanel.tsx`

---

## Phase 1 — Capture

- [x] Highlight（选中文字 → 浮标 → 批注卡片）
- [x] Box 框选（上下文菜单，含截图 + 叠层）
- [x] Line 手绘划线（上下文菜单，含截图 + 叠层）
- [x] Screenshot（`chrome.tabs.captureVisibleTab` + 裁剪 + 上传资产）
- [x] Underline 文字下划线（**2026-08-14 补齐捕获入口**，此前仅数据模型/渲染支持）
- [x] Anchor 捕获（`createFingerprintFromRange`：XPath + selectedText + prefix/suffix + context）

**Files**: `content.tsx`、`components/AnnotationCard.tsx`、`components/Bubble.tsx`、`utils/anchor.ts`、`background.ts`（contextMenus）、`utils/messaging.ts`

**已知问题**：
- `utils/settings.ts` 的 `annotationMode` 字段目前是死代码（未被任何 UI/逻辑消费），属遗留 cruft，暂不清理以避免无关改动。

### Bug Fix（2026-08-14）：创建第一条批注后侧栏不刷新

- **现象**：侧栏保持打开时，创建第一条批注后列表看不到；第二条起恢复正常。
- **根因**：`background.ts` 的 `diffAnnotationUrls` 在 `oldValue` 非数组（storage 键从 `undefined` → 数组）时直接 `return { urls: [], ids: [] }`，导致广播 `STORAGE_UPDATED` 的 `urls` 为空；`sidepanel.tsx` 监听器 `if (!p.urls?.length) return` 将空 `urls` 丢弃，不触发 `refresh()`。
- **修复**：将"非数组"归一化为空数组（`oldArr` / `newArr`），仅在两者皆空时返回空；使"无 → 有"正确计入 `urls`/`ids`，同步触发侧栏刷新与首条批注的即时 `syncPendingAnnotations`。

### Bug Fix（2026-08-14，二次）：本地批注因登录状态被清空

- **现象**：创建批注后（本地已落盘 `chrome.storage.local`），侧栏批注列表仍看不到。
- **根因（主）**：`sidepanel.tsx` 的 `refresh()` 中，只要 `!authState.isAuthenticated`（未登录 / token 过期且 QNote 刷新失败 / QNote 不可达），就执行 `setItems([])` 清空列表并 `setActiveTab("settings")` 强制切到设置页。而 `content.tsx` 的 `saveDraft` 不检查登录、直接 `upsertAnnotation` 写本地。二者冲突 → 批注落盘了却被 UI 隐藏，直接违反 Local First 原则。
- **修复**：将"认证状态"与"本地批注展示"解耦。`refresh()` 中：
  - 已登录：原样走 `hydrateAnnotationsFromQNote` + 更新用户信息。
  - 未登录：仅 `setSettings(loggedIn:false)` + `setQtables([])`，**不再 `setItems([])`、不再 `setActiveTab("settings")`、不再提前 `return`**，继续执行 `getAllAnnotations()` 渲染本地批注。
  - 登录状态现在只影响"同步 / 创建行动"能力，不影响本地数据可见性。

---

## Phase 2 — Organize

- [x] 批注列表（按 URL 分组、当前页/已选页切换）
- [x] 编辑批注（标题/内容，`updateAnnotationById`）
- [x] 删除批注（软删除 tombstone + QNote `deleteAnnotation`）
- [x] 双向同步（`hydrateAnnotationsFromQNote` + `syncAnnotationToQNote` + 本地优先合并）
- [ ] Inbox 归档/恢复（`archiveAnnotation` / `restoreAnnotation`）

**Backend Dependencies（已存在，未接线）**：
- QNote GraphQL 已提供 `archiveAnnotation(annotationId)`、`restoreAnnotation(annotationId)`、`inbox(...)` 查询。
- 本地 `NsXAnnotation` 尚未持久化 `status` 字段（服务端创建时为 `inbox`），接线前需先扩展本地模型并做迁移兼容。

**Files**: `components/AnnotationList.tsx`、`sidepanel.tsx`、`utils/storage.ts`、`utils/api.ts`

---

## Phase 3 — Action

- [x] 从批注创建 QTable 行动（`createTaskFromAnnotations`，幂等 `clientMutationId`）
- [x] 行动状态读取/更新（`/api/clipper/tasks/{id}/status` GET/PATCH）
- [x] 行动来源回溯（`qnote_annotation` URL 参数 → 定位原文）
- [x] QTable 目标表/负责人选项（`/api/clipper/action-options`）

**Files**: `utils/api.ts`、`sidepanel.tsx`、`components/TaskForm.tsx`

---

## Phase 4 — UX Enhancement

- [x] 批注选中高亮 + 点击定位原文
- [x] 同步状态指示（pending/syncing/synced/error + 自动重试）
- [x] 离线优先（本地立即显示，后台同步队列）
- [ ] OAuth 消息类型收口为 Typed Protocol（`background.ts` 中 `OAUTH_*`、`AUTH_STATE_CHANGED`、`AUTH_ERROR` 仍为裸字符串，属渐进迁移项）

**Files**: `utils/messaging.ts`、`background.ts`、`sidepanel.tsx`

---

## Phase 4.5 — 团队协作闭环（2026-08-14）

- [x] 以 QTable 工作区成员关系为唯一权威；QNote 只维护可失效的本地投影
- [x] 工作区切换：侧栏可切换团队空间，页面批注、目标表和负责人同步按空间过滤
- [x] 团队可见：同一工作区成员恢复并定位彼此的网页批注，同时显示创建者
- [x] 角色闭环：owner/editor 可写；viewer 在 UI 和 QNoteServer/QTable 两层均只读
- [x] 任务闭环：QTable 拒绝把 QNote 批注写入其他工作区的表，防止跨团队泄露
- [x] 协作资产：成员可读取同工作区截图；写入/删除仍须 editor 以上

### 内部试用验收（必须全部通过）

1. 在 QTable 创建工作区，邀请一位 editor 和一位 viewer。
2. editor 在 Clipper 切换到该工作区，创建批注并转为该空间的 QTable 任务。
3. 第二位 editor 刷新同一网页：能看到创建者、定位批注、编辑批注、更新任务状态。
4. viewer 刷新同一网页：能看到和定位全部批注与任务，但没有编辑、删除、创建任务或状态修改入口。
5. 试图把批注转到另一个工作区的 QTable 表时，服务端必须拒绝请求。
6. 将成员从 QTable 工作区移除后，等待身份投影刷新或重新登录；其 QNote/Clipper 请求必须返回无访问权限。

---

## Phase 5 — AI

- [ ] 未实现（需要后端 AI 能力，暂无接口）

---

## Anchor Engine（跨 Phase 高优先级）

定位优先级已实现：

```
DOM / XPath（elementByXPath + findBestInElement）
  ↓ 失败
TextQuote + Prefix + Suffix（scoreMatch，前缀/后缀 +2 分）
  ↓ 失败
Fuzzy Match（全文 indexOf 兜底，status=maybe_lost）
  ↓ 失败
Lost
```

**Files**: `utils/anchor.ts`（`createFingerprintFromRange` / `locateRangeFromFingerprint` / `getMergedClientRects`）

**兼容性**：已保留 `xpath` / `prefix` / `suffix` / `context` / `selectedText` 字段，与服务端 `anchorPayload` 互转（`utils/api.ts`）。

---

## 分层原则

- 所有 HTTP/GraphQL 集中在 `utils/api.ts` 与 `utils/auth.ts`，React 组件未直接 `fetch`。
- QNote 与 QTable 通过 QNote 的 `/api/clipper/*` 边界通信，扩展端不直连 QTable DB。
- 组件 → `utils/api`（ApiClient）之间当前无独立 Service/UseCase 层；因 `utils/api` 已封装全部网络与 GraphQL，暂不做大规模分层重构（避免破坏现有稳定功能）。

---

## Backend Dependencies 汇总

| 能力 | 后端接口 | 状态 |
|------|----------|------|
| 登录/刷新 | QNote `POST /api/clipper/session(/refresh)` | ✅ 已接线 |
| 身份 | QNote `GET /auth/me` | ✅ 已接线 |
| 工作区上下文 | QNote `GET /api/clipper/context` | ✅ 已接线 |
| 行动选项 | QNote `GET /api/clipper/action-options` | ✅ 已接线 |
| 行动状态 | QNote `GET/PATCH /api/clipper/tasks/{id}/status` | ✅ 已接线 |
| 批注 CRUD | QNote GraphQL `upsertWebSource`/`createAnnotation`/`updateAnnotation`/`deleteAnnotation`/`pageAnnotations` | ✅ 已接线 |
| 资产上传 | QNote `POST /api/assets/upload` | ✅ 已接线 |
| 创建行动 | QNote GraphQL `createTaskFromAnnotations` | ✅ 已接线 |
| Inbox 归档/恢复 | QNote GraphQL `archiveAnnotation`/`restoreAnnotation`/`inbox` | ⚠️ 后端就绪，前端未接线 |
| AI 能力 | — | ❌ 后端未提供 |
