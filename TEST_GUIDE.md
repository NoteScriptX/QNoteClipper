# QNote Clipper 内部试用验收

> 当前版本使用 **QNote 会话服务的账号密码登录**，不再使用 Mock
> Authentication 或浏览器 OAuth 跳转。请以本文件为准。

## 启动条件

1. 启动 QTable，创建至少一个工作区和一个行动表。
2. 启动 QNoteServer，并确认它和 QTable 使用相同的 `SECRET_KEY`，且
   `QTABLE_API_URL` 指向 QTable。
3. 为插件设置 `PLASMO_PUBLIC_QNOTE_API_URL` 和
   `PLASMO_PUBLIC_QTABLE_WEB_URL`；本地默认分别为 `http://localhost:9001`
   和 `http://localhost:9100`。
4. 在 `QNoteClipper` 目录运行 `pnpm build`，在 Chrome 扩展管理页加载
   `build/chrome-mv3-prod`。

## 单人闭环

1. 用 QTable 用户账号登录 Clipper。
2. 在网页上选中文字，写一条批注；刷新页面后批注仍能定位。
3. 在侧栏创建任务，选择当前工作区内的行动表和负责人。
4. 在 QTable 打开该任务，确认原文、来源页面和 QNote 回溯链接存在；从
   链接返回网页后能定位原文。
5. 在 Clipper 修改任务状态，确认 QTable 中状态同步更新。

## 团队协作闭环

1. 在 QTable 将第二名用户加入工作区，角色设为 `editor`；将第三名用户
   加入同一空间，角色设为 `viewer`。
2. editor A 在 Clipper 的工作区选择器中选中团队空间，创建批注和任务。
3. editor B 登录后打开同一网页：应看到 A 的创建者名称、能定位和编辑
   批注、并可更新关联任务状态。
4. viewer 登录后打开同一网页：应看到同一批注和任务，但编辑、删除、创建
   任务和状态下拉均不可用；尝试从旧页面或直接请求写接口也必须得到 403。
5. 选择另一个工作区后，页面批注、可选任务表和负责人均只显示该空间数据。
6. 尝试用 API 将团队 A 的批注创建到团队 B 的表中，QTable 必须返回 400。
7. 从 QTable 移除成员后重新登录该成员；其对该空间的 QNote 请求必须被拒绝。

## 发布前质量门

```bash
# QNoteServer
pytest -q

# QTable
PYTHONPATH=. pytest -q tests/test_clipper_integration.py tests/test_auth_refresh.py

# QNoteClipper
pnpm build

# QNote desktop
npm run typecheck
```

本轮团队协作实现已覆盖上述前三项自动验证；桌面端仅接入了共享身份初始化，
文件协作/实时共同编辑不在本次 Clipper 内部试用范围。
