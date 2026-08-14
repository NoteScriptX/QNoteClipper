export const NSX_ANNOTATIONS_KEY = "nsx_annotations_v1"
const NSX_DELETED_ANNOTATION_IDS_KEY = "nsx_deleted_annotation_ids_v1"

export const normalizePageUrl = (value: string): string => {
  try {
    const url = new URL(value)
    url.searchParams.delete("qnote_annotation")
    url.hash = ""
    return url.toString()
  } catch {
    return value
  }
}

export type AnnotationMode = "highlight" | "line" | "box" | "underline"

export type NsXAnnotation = {
  id: string
  url: string
  pageTitle?: string
  createdAt: number
  selectedText: string
  title?: string
  note?: string
  mode?: AnnotationMode
  box?: { left: number; top: number; width: number; height: number }
  line?: { x: number; y: number }[]
  shapeAnchor?: { left: number; top: number; width: number; height: number }
  screenshotDataUrl?: string
  task?: {
    status: "created"
    taskId: string
    qtableUrl?: string
    tableId?: string
    statusFieldId?: string
    statusFieldName?: string
    statusFieldType?: string
    statusValue?: string
    statusOptions?: { id: string; label: string }[]
  }
  anchor: {
    selectedText?: string
    xpath: string
    prefix: string
    suffix: string
    context: string
  }
  locateStatus?: "ok" | "maybe_lost"
  serverId?: string
  userId?: number
  serverVersion?: number
  workspaceId?: string
  assetId?: string
  syncStatus?: "pending" | "syncing" | "synced" | "error"
  syncError?: string
  pendingTaskMutationId?: string
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const safeBox = (value: NsXAnnotation["box"]): NsXAnnotation["box"] => {
  if (!value || typeof value !== "object") return undefined
  return {
    left: finiteNumber(value.left),
    top: finiteNumber(value.top),
    width: finiteNumber(value.width),
    height: finiteNumber(value.height)
  }
}

/**
 * `chrome.storage` accepts JSON-like values only. Keep this boundary explicit:
 * selection and drawing APIs expose browser objects (for example DOMRect and
 * Window-backed values) that must never leak into the persisted annotation.
 */
const serializeAnnotation = (annotation: NsXAnnotation): NsXAnnotation => ({
  id: optionalString(annotation.id) || "",
  url: optionalString(annotation.url) || "",
  pageTitle: optionalString(annotation.pageTitle),
  createdAt: finiteNumber(annotation.createdAt, Date.now()),
  selectedText: optionalString(annotation.selectedText) || "",
  title: optionalString(annotation.title),
  note: optionalString(annotation.note),
  mode: ["highlight", "line", "box", "underline"].includes(annotation.mode || "")
    ? annotation.mode
    : "highlight",
  box: safeBox(annotation.box),
  line: Array.isArray(annotation.line)
    ? annotation.line.map((point) => ({
        x: finiteNumber(point?.x),
        y: finiteNumber(point?.y)
      }))
    : undefined,
  shapeAnchor: safeBox(annotation.shapeAnchor),
  screenshotDataUrl: optionalString(annotation.screenshotDataUrl),
  task: annotation.task?.status === "created"
    ? {
        status: "created",
        taskId: optionalString(annotation.task.taskId) || "",
        qtableUrl: optionalString(annotation.task.qtableUrl),
        tableId: optionalString(annotation.task.tableId),
        statusFieldId: optionalString(annotation.task.statusFieldId),
        statusFieldName: optionalString(annotation.task.statusFieldName),
        statusFieldType: optionalString(annotation.task.statusFieldType),
        statusValue: optionalString(annotation.task.statusValue),
        statusOptions: Array.isArray(annotation.task.statusOptions)
          ? annotation.task.statusOptions
              .filter((option) => typeof option?.id === "string" && typeof option?.label === "string")
              .map((option) => ({ id: option.id, label: option.label }))
          : undefined
      }
    : undefined,
  anchor: {
    selectedText: optionalString(annotation.anchor?.selectedText),
    xpath: optionalString(annotation.anchor?.xpath) || "",
    prefix: optionalString(annotation.anchor?.prefix) || "",
    suffix: optionalString(annotation.anchor?.suffix) || "",
    context: optionalString(annotation.anchor?.context) || ""
  },
  locateStatus: annotation.locateStatus === "maybe_lost" ? "maybe_lost" : "ok",
  serverId: optionalString(annotation.serverId),
  userId: finiteNumber(annotation.userId, 0) || undefined,
  serverVersion: finiteNumber(annotation.serverVersion, 0) || undefined,
  workspaceId: optionalString(annotation.workspaceId),
  assetId: optionalString(annotation.assetId),
  syncStatus: ["pending", "syncing", "synced", "error"].includes(annotation.syncStatus || "")
    ? annotation.syncStatus
    : undefined,
  syncError: optionalString(annotation.syncError),
  pendingTaskMutationId: optionalString(annotation.pendingTaskMutationId)
})

export const getAllAnnotations = async (): Promise<NsXAnnotation[]> => {
  const res = await chrome.storage.local.get(NSX_ANNOTATIONS_KEY)
  const raw = res?.[NSX_ANNOTATIONS_KEY]
  if (!Array.isArray(raw)) return []
  return raw as NsXAnnotation[]
}

export const getAnnotationById = async (
  id: string
): Promise<NsXAnnotation | null> => {
  const all = await getAllAnnotations()
  return all.find((a) => a.id === id) ?? null
}

export const setAllAnnotations = async (
  annotations: NsXAnnotation[]
): Promise<void> => {
  const current = (await getAllAnnotations()).map(serializeAnnotation)
  const next = annotations.map(serializeAnnotation)
  if (JSON.stringify(current) === JSON.stringify(next)) return
  await chrome.storage.local.set({
    [NSX_ANNOTATIONS_KEY]: next
  })
}

export const getAnnotationsByUrl = async (
  url: string
): Promise<NsXAnnotation[]> => {
  const all = await getAllAnnotations()
  const normalized = normalizePageUrl(url)
  return all.filter((a) => normalizePageUrl(a.url) === normalized)
}

export const upsertAnnotation = async (
  annotation: NsXAnnotation
): Promise<void> => {
  const all = await getAllAnnotations()
  const next = [...all]
  const idx = next.findIndex((a) => a.id === annotation.id)
  const pending = { ...annotation, syncStatus: "pending" as const, syncError: undefined }
  if (idx >= 0) next[idx] = pending
  else next.unshift(pending)
  await setAllAnnotations(next)
}

export const updateAnnotationById = async (
  id: string,
  updater: (a: NsXAnnotation) => NsXAnnotation
): Promise<void> => {
  const all = await getAllAnnotations()
  const idx = all.findIndex((a) => a.id === id)
  if (idx < 0) return
  const next = [...all]
  next[idx] = {
    ...updater(next[idx]),
    syncStatus: "pending",
    syncError: undefined
  }
  await setAllAnnotations(next)
}

/** Update display-only metadata without scheduling another QNote sync. */
export const updateAnnotationLocallyById = async (
  id: string,
  updater: (a: NsXAnnotation) => NsXAnnotation
): Promise<void> => {
  const all = await getAllAnnotations()
  const idx = all.findIndex((a) => a.id === id)
  if (idx < 0) return
  const next = [...all]
  next[idx] = updater(next[idx])
  await setAllAnnotations(next)
}

export const markAnnotationSyncing = async (id: string): Promise<void> => {
  const all = await getAllAnnotations()
  const idx = all.findIndex((annotation) => annotation.id === id)
  if (idx < 0) return
  const next = [...all]
  next[idx] = { ...next[idx], syncStatus: "syncing", syncError: undefined }
  await setAllAnnotations(next)
}

export const deleteAnnotationLocallyById = async (id: string): Promise<void> => {
  const all = await getAllAnnotations()
  const annotation = all.find((item) => item.id === id)
  const next = all.filter((annotation) => annotation.id !== id)
  if (next.length === all.length) return
  const deletedIds = await getDeletedAnnotationIds()
  const tombstones = [id, annotation?.serverId, ...deletedIds]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 500)
  await chrome.storage.local.set({
    [NSX_ANNOTATIONS_KEY]: next,
    [NSX_DELETED_ANNOTATION_IDS_KEY]: tombstones
  })
}

const getDeletedAnnotationIds = async (): Promise<string[]> => {
  const result = await chrome.storage.local.get(NSX_DELETED_ANNOTATION_IDS_KEY)
  const value = result[NSX_DELETED_ANNOTATION_IDS_KEY]
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

const mergeServerAnnotation = (
  current: NsXAnnotation,
  incoming: NsXAnnotation,
  preserveUnsynced = false
): NsXAnnotation => {
  const currentTask = current.task
  const incomingTask = incoming.task
  const task =
    currentTask?.status === "created" &&
    incomingTask?.status === "created" &&
    currentTask.taskId === incomingTask.taskId
      ? { ...currentTask, ...incomingTask }
      : incomingTask
  const preserveNewerLocalEdit =
    incoming.syncStatus === "synced" && (
      current.syncStatus === "pending" ||
      (preserveUnsynced && (current.syncStatus === "syncing" || current.syncStatus === "error"))
    )
  if (preserveNewerLocalEdit) {
    return {
      ...incoming,
      ...current,
      serverId: incoming.serverId || current.serverId,
      userId: incoming.userId || current.userId,
      serverVersion: incoming.serverVersion || current.serverVersion,
      workspaceId: incoming.workspaceId || current.workspaceId,
      assetId: incoming.assetId || current.assetId,
      task,
      syncStatus: "pending",
      syncError: undefined
    }
  }
  return {
    ...current,
    ...incoming,
    anchor: {
      ...current.anchor,
      ...incoming.anchor,
      selectedText: incoming.anchor.selectedText || current.anchor.selectedText || current.selectedText
    },
    box: incoming.box || current.box,
    line: incoming.line?.length ? incoming.line : current.line,
    shapeAnchor: incoming.shapeAnchor || current.shapeAnchor,
    task
  }
}

export const applyServerAnnotation = async (
  annotation: NsXAnnotation
): Promise<void> => {
  const deletedIds = await getDeletedAnnotationIds()
  if (deletedIds.includes(annotation.id) || Boolean(annotation.serverId && deletedIds.includes(annotation.serverId))) return
  const all = await getAllAnnotations()
  const next = [...all]
  const idx = next.findIndex(
    (item) => item.id === annotation.id ||
      (annotation.serverId && item.serverId === annotation.serverId)
  )
  const synced = { ...annotation, syncStatus: "synced" as const, syncError: undefined }
  if (idx >= 0) next[idx] = mergeServerAnnotation(next[idx], synced)
  else next.unshift(synced)
  await setAllAnnotations(next)
}

export const applyServerAnnotations = async (
  annotations: NsXAnnotation[]
): Promise<void> => {
  if (!annotations.length) return
  const deletedIds = await getDeletedAnnotationIds()
  const current = await getAllAnnotations()
  const next = [...current]
  for (const annotation of annotations) {
    if (deletedIds.includes(annotation.id) || Boolean(annotation.serverId && deletedIds.includes(annotation.serverId))) continue
    const idx = next.findIndex(
      (item) => item.id === annotation.id ||
        (annotation.serverId && item.serverId === annotation.serverId)
    )
    const synced = {
      ...annotation,
      syncStatus: "synced" as const,
      syncError: undefined
    }
    if (idx >= 0) next[idx] = mergeServerAnnotation(next[idx], synced, true)
    else next.unshift(synced)
  }
  await setAllAnnotations(next)
}

export const markAnnotationSyncError = async (
  id: string,
  message: string
): Promise<void> => {
  const all = await getAllAnnotations()
  const idx = all.findIndex((annotation) => annotation.id === id)
  if (idx < 0) return
  if (all[idx].syncStatus === "pending") return
  const next = [...all]
  next[idx] = {
    ...next[idx],
    syncStatus: "error",
    syncError: message.slice(0, 500)
  }
  await setAllAnnotations(next)
}
