import { getValidAccessToken, QNOTE_API_BASE_URL, QTABLE_WEB_BASE_URL } from "./auth"
import {
  applyServerAnnotation,
  applyServerAnnotations,
  getAnnotationById,
  type AnnotationMode,
  type NsXAnnotation
} from "./storage"

export { QNOTE_API_BASE_URL }

export type SharedContext = {
  user: { id: number; name: string; email: string }
  workspaces: { id: string; name?: string; role: string }[]
  default_workspace_id?: string
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

export type CreateTaskFromAnnotationInput = {
  annotationId: string
  task: {
    title: string
    assignee_email?: string
    due_date?: string
    target_table_id: string
    note?: string
  }
}

export type CreateTaskFromAnnotationResponse = {
  task_id: string
  qtable_url: string
  annotation_status: "task_created"
  target_table_id?: string
  record_id?: string
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

let contextCache: { value: SharedContext; expiresAt: number } | null = null

const messageFromPayload = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== "object") return fallback
  const value = payload as { detail?: unknown; error?: { message?: unknown }; message?: unknown }
  if (typeof value.detail === "string") return value.detail
  if (typeof value.error?.message === "string") return value.error.message
  return typeof value.message === "string" ? value.message : fallback
}

async function authenticatedFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error("请先登录 QNote")

  const headers = new Headers(options.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (options.body && !headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  return await fetch(`${QNOTE_API_BASE_URL}${path}`, { ...options, headers })
}

const qnoteGraphQL = async <T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> => {
  const response = await authenticatedFetch("/graphql", {
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

export const getSharedContext = async (): Promise<SharedContext> => {
  if (contextCache && contextCache.expiresAt > Date.now()) return contextCache.value
  const response = await authenticatedFetch("/api/clipper/context")
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(messageFromPayload(payload, "无法读取 QNote 工作区"))
  const value = payload as SharedContext
  contextCache = { value, expiresAt: Date.now() + 60_000 }
  return value
}

const uploadScreenshot = async (
  dataUrl: string,
  workspaceId: string,
  annotationId: string
): Promise<string> => {
  const blob = await fetch(dataUrl).then((response) => response.blob())
  const body = new FormData()
  body.append("type", "screenshot")
  body.append("file", blob, `qnote-${annotationId}.png`)
  const response = await authenticatedFetch(
    `/api/assets/upload?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: "POST", body }
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
  if (!workspaceId) throw new Error("当前账号没有可用 QNote 工作区")

  const sourceData = await qnoteGraphQL<{ upsertWebSource: { id: string } }>(
    `mutation UpsertSource($input: UpsertWebSourceInput!) {
      upsertWebSource(input: $input) { id }
    }`,
    { input: { url: annotation.url, title: annotation.pageTitle || "", workspaceId } }
  )

  let assetId = annotation.assetId
  if (!assetId && annotation.screenshotDataUrl) {
    assetId = await uploadScreenshot(annotation.screenshotDataUrl, workspaceId, annotation.id)
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
    const data = await qnoteGraphQL<{ updateAnnotation: { annotation: { id: string; version: number } } }>(
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
    const data = await qnoteGraphQL<{ createAnnotation: { annotation: { id: string; version: number } } }>(
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

export const getActionOptions = async (): Promise<{ tables: QTable[]; users: QTableUser[] }> => {
  const response = await authenticatedFetch("/api/clipper/action-options")
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(messageFromPayload(payload, "无法加载行动选项"))
  return payload as { tables: QTable[]; users: QTableUser[] }
}

export const getTaskStatus = async (
  taskId: string,
  targetTableId: string
): Promise<UpdateTaskStatusResponse> => {
  const response = await authenticatedFetch(
    `/api/clipper/tasks/${encodeURIComponent(taskId)}/status?target_table_id=${encodeURIComponent(targetTableId)}`
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(messageFromPayload(payload, "读取行动状态失败"))
  return payload as UpdateTaskStatusResponse
}

export const updateTaskStatus = async (
  input: UpdateTaskStatusInput
): Promise<UpdateTaskStatusResponse> => {
  const response = await authenticatedFetch(
    `/api/clipper/tasks/${encodeURIComponent(input.taskId)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        target_table_id: input.targetTableId,
        status_field_id: input.statusFieldId,
        value: input.value
      })
    }
  )
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(messageFromPayload(payload, "更新行动状态失败"))
  return payload as UpdateTaskStatusResponse
}

export const createTaskFromAnnotation = async (
  input: CreateTaskFromAnnotationInput
): Promise<CreateTaskFromAnnotationResponse> => {
  const title = input.task.title.trim()
  if (!title || title.length > 200) throw new Error("行动标题长度需为 1-200 字符")
  if (!input.task.target_table_id.trim()) throw new Error("请选择目标行动表")

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
  if (!synced.serverId) throw new Error("批注尚未同步到 QNote")

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
        targetTableId: input.task.target_table_id,
        title,
        assigneeEmail: input.task.assignee_email?.trim() || null,
        dueDate: input.task.due_date || null,
        workspaceId: synced.workspaceId,
        clientMutationId: mutationId
      }
    }
  )
  const task = data.createTaskFromAnnotations
  const tableId = task.tableId || input.task.target_table_id
  const qtableUrl = task.qtableUrl || `${QTABLE_WEB_BASE_URL}/table/${tableId}?row=${task.recordId || task.taskId}`
  await applyServerAnnotation({
    ...synced,
    pendingTaskMutationId: undefined,
    task: { status: "created", taskId: task.taskId, tableId, qtableUrl }
  })
  return {
    task_id: task.taskId,
    record_id: task.recordId,
    qtable_url: qtableUrl,
    annotation_status: "task_created",
    target_table_id: tableId
  }
}
