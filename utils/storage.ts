export const NSX_ANNOTATIONS_KEY = "nsx_annotations_v1"

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
    xpath: string
    prefix: string
    suffix: string
    context: string
  }
  locateStatus?: "ok" | "maybe_lost"
  serverId?: string
  serverVersion?: number
  workspaceId?: string
  assetId?: string
  syncStatus?: "pending" | "syncing" | "synced" | "error"
  syncError?: string
  pendingTaskMutationId?: string
}

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
  const current = await getAllAnnotations()
  if (JSON.stringify(current) === JSON.stringify(annotations)) return
  await chrome.storage.local.set({
    [NSX_ANNOTATIONS_KEY]: annotations
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

const mergeServerAnnotation = (
  current: NsXAnnotation,
  incoming: NsXAnnotation
): NsXAnnotation => {
  const currentTask = current.task
  const incomingTask = incoming.task
  const task =
    currentTask?.status === "created" &&
    incomingTask?.status === "created" &&
    currentTask.taskId === incomingTask.taskId
      ? { ...currentTask, ...incomingTask }
      : incomingTask
  return { ...current, ...incoming, task }
}

export const applyServerAnnotation = async (
  annotation: NsXAnnotation
): Promise<void> => {
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
  const current = await getAllAnnotations()
  const next = [...current]
  for (const annotation of annotations) {
    const idx = next.findIndex(
      (item) => item.id === annotation.id ||
        (annotation.serverId && item.serverId === annotation.serverId)
    )
    const synced = {
      ...annotation,
      syncStatus: "synced" as const,
      syncError: undefined
    }
    if (idx >= 0) next[idx] = mergeServerAnnotation(next[idx], synced)
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
  const next = [...all]
  next[idx] = {
    ...next[idx],
    syncStatus: "error",
    syncError: message.slice(0, 500)
  }
  await setAllAnnotations(next)
}
