import { getValidAccessToken, QTABLE_API_BASE_URL, QTABLE_WEB_BASE_URL } from "./auth"
import {
  applyServerAnnotation,
  applyServerAnnotations,
  getAnnotationById,
  type AnnotationMode,
  type NsXAnnotation
} from "./storage"

export const QNOTE_API_BASE_URL =
  process.env.PLASMO_PUBLIC_QNOTE_API_URL || "http://localhost:9200"

type SharedContext = {
  user: { id: number; name: string; email: string }
  workspaces: { id: string; name?: string; role: string }[]
  default_workspace_id?: string
}

let contextCache: { value: SharedContext; expiresAt: number } | null = null

const getSharedContext = async (): Promise<SharedContext> => {
  if (contextCache && contextCache.expiresAt > Date.now()) return contextCache.value
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/context`)
  if (!response.ok) throw new Error("无法读取 NoteScriptX 工作区")
  const value = (await response.json()) as SharedContext
  contextCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

const qnoteGraphQL = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const response = await authenticatedFetch(`${QNOTE_API_BASE_URL}/graphql`, {
    method: "POST",
    body: JSON.stringify({ query, variables })
  })
  const payload = await response.json().catch(() => ({})) as {
    data?: T
    errors?: { message?: string; extensions?: { code?: string } }[]
    error?: { message?: string }
  }
  if (!response.ok || payload.errors?.length || !payload.data) {
    const first = payload.errors?.[0]
    throw new Error(first?.message || payload.error?.message || `QNote 服务请求失败（${response.status}）`)
  }
  return payload.data
}

const uploadScreenshot = async (
  dataUrl: string,
  workspaceId: string,
  annotationId: string
): Promise<string> => {
  const token = await getValidAccessToken()
  if (!token) throw new Error("Not authenticated. Please log in.")
  const blob = await fetch(dataUrl).then((response) => response.blob())
  const body = new FormData()
  body.append("type", "screenshot")
  body.append("file", blob, `qnote-${annotationId}.png`)
  const response = await fetch(
    `${QNOTE_API_BASE_URL}/api/assets/upload?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }
  )
  const payload = await response.json().catch(() => ({})) as { id?: string; detail?: string }
  if (!response.ok || !payload.id) throw new Error(payload.detail || "批注截图上传失败")
  return payload.id
}

const annotationExtra = (annotation: NsXAnnotation) => ({
  box: annotation.box,
  line: annotation.line,
  shapeAnchor: annotation.shapeAnchor,
  locateStatus: annotation.locateStatus
})

export const syncAnnotationToQNote = async (
  annotation: NsXAnnotation
): Promise<NsXAnnotation> => {
  const context = await getSharedContext()
  const workspaceId = annotation.workspaceId || context.default_workspace_id || context.workspaces[0]?.id
  if (!workspaceId) throw new Error("当前账号没有可用工作区")

  const sourceData = await qnoteGraphQL<{
    upsertWebSource: { id: string }
  }>(
    `mutation UpsertSource($input: UpsertWebSourceInput!) {
      upsertWebSource(input: $input) { id }
    }`,
    { input: { url: annotation.url, title: annotation.pageTitle || "", workspaceId } }
  )

  let assetId = annotation.assetId
  const screenshotDataUrl = (annotation as NsXAnnotation & { screenshotDataUrl?: string }).screenshotDataUrl
  if (!assetId && screenshotDataUrl) {
    assetId = await uploadScreenshot(screenshotDataUrl, workspaceId, annotation.id)
  }

  const anchor = {
    selectorType: "textQuote",
    selectorVersion: 1,
    xpath: annotation.anchor.xpath || null,
    selectedText: annotation.selectedText || null,
    textPrefix: annotation.anchor.prefix || null,
    textSuffix: annotation.anchor.suffix || null,
    contextText: annotation.anchor.context || null,
    locateStatus: annotation.locateStatus === "maybe_lost" ? "lost" : "exact",
    anchorPayload: { ...annotation.anchor, ...annotationExtra(annotation) }
  }

  let server: { id: string; version: number }
  if (annotation.serverId) {
    const data = await qnoteGraphQL<{
      updateAnnotation: { annotation: { id: string; version: number } }
    }>(
      `mutation UpdateAnnotation($input: UpdateAnnotationInput!) {
        updateAnnotation(input: $input) { annotation { id version } }
      }`,
      {
        input: {
          annotationId: annotation.serverId,
          expectedVersion: annotation.serverVersion,
          type: annotation.mode || "highlight",
          selectedText: annotation.selectedText,
          title: annotation.title || annotation.pageTitle || null,
          comment: annotation.note || null,
          assetId: assetId || null,
          anchor,
          extra: annotationExtra(annotation)
        }
      }
    )
    server = data.updateAnnotation.annotation
  } else {
    const data = await qnoteGraphQL<{
      createAnnotation: { annotation: { id: string; version: number } }
    }>(
      `mutation CreateAnnotation($input: CreateAnnotationInput!) {
        createAnnotation(input: $input) { annotation { id version } }
      }`,
      {
        input: {
          sourceId: sourceData.upsertWebSource.id,
          type: annotation.mode || "highlight",
          selectedText: annotation.selectedText,
          title: annotation.title || annotation.pageTitle || null,
          comment: annotation.note || null,
          status: "inbox",
          assetId: assetId || null,
          clientId: annotation.id,
          clientCreatedAt: new Date(annotation.createdAt).toISOString(),
          anchor,
          extra: annotationExtra(annotation),
          workspaceId
        }
      }
    )
    server = data.createAnnotation.annotation
  }

  const synced: NsXAnnotation = {
    ...annotation,
    screenshotDataUrl: undefined,
    serverId: server.id,
    serverVersion: server.version,
    workspaceId,
    assetId,
    syncStatus: "synced",
    syncError: undefined
  }
  await applyServerAnnotation(synced)
  return synced
}

type PageAnnotationContext = {
  annotation: {
    id: string
    clientId?: string
    type: string
    selectedText?: string
    title?: string
    comment?: string
    version: number
    createdAt?: string
    extra?: Record<string, unknown>
    assetId?: string
  }
  source: { url: string; title?: string; workspaceId: string }
  anchor?: {
    xpath?: string
    textPrefix?: string
    textSuffix?: string
    contextText?: string
    locateStatus?: string
    anchorPayload?: Record<string, unknown>
  }
  relations: {
    qtableTaskId: string
    qtableTableId?: string
    qtableRecordId?: string
  }[]
}

export const hydrateAnnotationsFromQNote = async (url: string): Promise<void> => {
  const context = await getSharedContext()
  const workspaceId = context.default_workspace_id || context.workspaces[0]?.id
  if (!workspaceId || !url) return
  const data = await qnoteGraphQL<{ pageAnnotations: PageAnnotationContext[] }>(
    `query PageAnnotations($url: String!, $workspaceId: String!) {
      pageAnnotations(url: $url, workspaceId: $workspaceId) {
        annotation { id clientId type selectedText title comment version createdAt extra assetId }
        source { url title workspaceId }
        anchor { xpath textPrefix textSuffix contextText locateStatus anchorPayload }
        relations { qtableTaskId qtableTableId qtableRecordId }
      }
    }`,
    { url, workspaceId }
  )
  const hydrated = data.pageAnnotations.map((item): NsXAnnotation => {
    const payload = item.anchor?.anchorPayload || {}
    const extra = item.annotation.extra || {}
    const relation = item.relations[0]
    const mode = (["highlight", "underline", "line", "box"] as string[]).includes(item.annotation.type)
      ? item.annotation.type as AnnotationMode
      : "highlight"
    return {
      id: item.annotation.clientId || item.annotation.id,
      serverId: item.annotation.id,
      serverVersion: item.annotation.version,
      workspaceId: item.source.workspaceId,
      assetId: item.annotation.assetId,
      url: item.source.url,
      pageTitle: item.source.title,
      createdAt: item.annotation.createdAt ? Date.parse(item.annotation.createdAt) : Date.now(),
      selectedText: item.annotation.selectedText || "",
      title: item.annotation.title,
      note: item.annotation.comment,
      mode,
      anchor: {
        xpath: item.anchor?.xpath || String(payload.xpath || ""),
        prefix: item.anchor?.textPrefix || String(payload.prefix || ""),
        suffix: item.anchor?.textSuffix || String(payload.suffix || ""),
        context: item.anchor?.contextText || String(payload.context || "")
      },
      locateStatus: item.anchor?.locateStatus === "lost" ? "maybe_lost" : "ok",
      box: (extra.box || payload.box) as NsXAnnotation["box"],
      line: (extra.line || payload.line) as NsXAnnotation["line"],
      shapeAnchor: (extra.shapeAnchor || payload.shapeAnchor) as NsXAnnotation["shapeAnchor"],
      task: relation ? {
        status: "created",
        taskId: relation.qtableTaskId,
        tableId: relation.qtableTableId,
        qtableUrl: relation.qtableTableId
          ? `${QTABLE_WEB_BASE_URL}/table/${relation.qtableTableId}?row=${relation.qtableRecordId || relation.qtableTaskId}`
          : undefined
      } : undefined,
      syncStatus: "synced"
    }
  })
  await applyServerAnnotations(hydrated)
}

export type QTable = {
  id: string
  name: string
  emoji?: string
  row_count: number
}

export type QTableUser = {
  id: number
  name: string
  email: string
}

/**
 * Helper function to make authenticated API requests
 */
async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  retryCount = 0
): Promise<Response> {
  const token = await getValidAccessToken()
  
  if (!token) {
    throw new Error("Not authenticated. Please log in.")
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  // Handle 401 - token might be expired
  if (response.status === 401 && retryCount === 0) {
    // Force token refresh by clearing cached state
    const newToken = await getValidAccessToken()
    if (newToken && newToken !== token) {
      // Retry with new token
      headers.Authorization = `Bearer ${newToken}`
      return await fetch(url, {
        ...options,
        headers
      })
    }
  }

  return response
}

export const getQtables = async (): Promise<QTable[]> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/tables`)
  if (!response.ok) throw new Error("加载 QTable 表格失败")
  return (await response.json()) as QTable[]
}

export const getQtableUsers = async (): Promise<QTableUser[]> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/users`)
  if (!response.ok) throw new Error("加载 QTable 用户失败")
  return (await response.json()) as QTableUser[]
}

export type ApiError = {
  error: string
  message: string
}

export type CreateTaskFromAnnotationInput = {
  annotationId: string
  task: {
    title: string
    assignee_email?: string
    due_date?: string
    target_table_id: string
    include_context_url?: boolean
    note?: string
    selected_text?: string
    page_url?: string
    page_title?: string
    mode?: "highlight" | "line" | "box" | "underline"
    screenshot_data_url?: string
  }
}

export type CreateTaskFromAnnotationResponse = {
  task_id: string
  qtable_url: string
  annotation_status: "task_created"
  target_table_id?: string
  status?: QTableTaskStatus
}

export type QTableTaskStatus = {
  field_id: string
  field_name: string
  field_type: string
  options: { id: string; label: string }[]
  value?: string
}

export type UpdateTaskStatusInput = {
  taskId: string
  targetTableId: string
  statusFieldId?: string
  value: string
}

export type UpdateTaskStatusResponse = {
  task_id: string
  target_table_id: string
  status: QTableTaskStatus
}

export const getTaskStatus = async (
  taskId: string,
  targetTableId: string
): Promise<UpdateTaskStatusResponse> => {
  const response = await authenticatedFetch(QTABLE_API_BASE_URL + "/api/clipper/tasks/" + encodeURIComponent(taskId) + "/status?target_table_id=" + encodeURIComponent(targetTableId))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || "读取 QTable 任务状态失败")
  return data as UpdateTaskStatusResponse
}

type StoredTask = {
  task_id: string
  annotation_id: string
  title: string
  assignee_email: string
  due_date?: string
  target_table_id: string
  include_context_url: boolean
  created_at: string
  qtable_url: string
}

const delay = async <T>(value: T, ms: number): Promise<T> =>
  await new Promise((resolve) => setTimeout(() => resolve(value), ms))

const tasksKey = "nsx_mock_tasks_v2"

const readTasks = (): StoredTask[] => {
  try {
    const raw = localStorage.getItem(tasksKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as StoredTask[]) : []
  } catch {
    return []
  }
}

const writeTasks = (tasks: StoredTask[]) => {
  localStorage.setItem(tasksKey, JSON.stringify(tasks))
}

const genTaskId = (tasks: StoredTask[]) => {
  const n = tasks.length + 1
  return `task_${String(n).padStart(4, "0")}`
}

const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const createTaskFromAnnotation = async (
  input: CreateTaskFromAnnotationInput
): Promise<CreateTaskFromAnnotationResponse> => {
  // Validation (keep existing validation logic)
  const title = input.task.title.trim()
  if (title.length < 1 || title.length > 200) {
    throw {
      error: "invalid_title",
      message: "任务标题长度需为 1-200 字符。"
    } satisfies ApiError
  }

  const assigneeEmail = (input.task.assignee_email ?? "").trim()

  const dueDate = input.task.due_date?.trim()
  if (dueDate && !isValidDate(dueDate)) {
    throw {
      error: "invalid_due_date",
      message: "截止日期格式应为 YYYY-MM-DD。"
    } satisfies ApiError
  }

  const tableId = input.task.target_table_id.trim()
  if (!tableId) {
    throw {
      error: "invalid_target_table_id",
      message: "请选择目标表格。"
    } satisfies ApiError
  }

  const local = await getAnnotationById(input.annotationId)
  if (!local) throw new Error("批注不存在")
  const mutationId = local.pendingTaskMutationId || crypto.randomUUID()
  if (!local.pendingTaskMutationId) {
    await applyServerAnnotation({ ...local, pendingTaskMutationId: mutationId })
  }
  const synced = await syncAnnotationToQNote({
    ...local,
    title,
    note: input.task.note ?? local.note,
    pendingTaskMutationId: mutationId
  })
  const data = await qnoteGraphQL<{
    createTaskFromAnnotations: {
      taskId: string
      tableId?: string
      recordId?: string
      qtableUrl?: string
    }
  }>(
    `mutation CreateTask($input: CreateTaskFromAnnotationsInput!) {
      createTaskFromAnnotations(input: $input) {
        taskId tableId recordId qtableUrl relationIds
      }
    }`,
    {
      input: {
        annotationIds: [synced.serverId],
        targetTableId: tableId,
        title,
        assigneeEmail: assigneeEmail || null,
        dueDate: dueDate || null,
        workspaceId: synced.workspaceId,
        clientMutationId: mutationId
      }
    }
  )
  const task = data.createTaskFromAnnotations
  await applyServerAnnotation({
    ...synced,
    pendingTaskMutationId: undefined,
    task: {
      status: "created",
      taskId: task.taskId,
      tableId: task.tableId || tableId,
      qtableUrl: task.qtableUrl
    }
  })
  return {
    task_id: task.taskId,
    qtable_url: task.qtableUrl || `${QTABLE_WEB_BASE_URL}/table/${task.tableId || tableId}?row=${task.recordId || task.taskId}`,
    annotation_status: "task_created",
    target_table_id: task.tableId || tableId
  }
}

export const updateTaskStatus = async (
  input: UpdateTaskStatusInput
): Promise<UpdateTaskStatusResponse> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/tasks/${encodeURIComponent(input.taskId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      target_table_id: input.targetTableId,
      status_field_id: input.statusFieldId,
      value: input.value
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || "更新 QTable 任务状态失败")
  return data as UpdateTaskStatusResponse
}

export type UserMe = {
  id: string
  name: string
  email: string
  avatar_url: string
}

export const getUserMe = async (): Promise<UserMe> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/oauth/me`)
  if (!response.ok) throw new Error("获取用户信息失败")
  return (await response.json()) as UserMe
}

export type AnnotationTaskDTO = {
  id: string
  status: "open"
  assignee_email: string
  due_date?: string
}

export type AnnotationDTO = {
  id: string
  page_url: string
  page_title: string
  selected_text: string
  note: string
  created_at: string
  task: AnnotationTaskDTO | null
}

export const getAnnotation = async (input: {
  annotationId: string
  local?: {
    url: string
    pageTitle: string
    selectedText: string
    note: string
    createdAt: number
    task?: { taskId: string }
  }
}): Promise<AnnotationDTO> => {
  const a = input.local
  if (!a) {
    throw { error: "not_found", message: "批注不存在。" } satisfies ApiError
  }
  const tasks = readTasks()
  const t = a.task?.taskId
    ? tasks.find((x) => x.task_id === a.task?.taskId)
    : undefined

  return await delay(
    {
      id: input.annotationId,
      page_url: a.url,
      page_title: a.pageTitle,
      selected_text: a.selectedText,
      note: a.note,
      created_at: new Date(a.createdAt).toISOString(),
      task: t
        ? {
            id: t.task_id,
            status: "open",
            assignee_email: t.assignee_email,
            due_date: t.due_date
          }
        : null
    },
    140
  )
}
