export const CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION =
  "CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION" as const

export const STORAGE_UPDATED = "STORAGE_UPDATED" as const

export const SIDEPANEL_TASK_CREATED = "SIDEPANEL_TASK_CREATED" as const
export const CONTENT_OPEN_SELECTION_CARD = "CONTENT_OPEN_SELECTION_CARD" as const
export const CONTENT_ACTIVATE_DRAW_MODE = "CONTENT_ACTIVATE_DRAW_MODE" as const
export const CONTENT_LOCATE_ANNOTATION = "CONTENT_LOCATE_ANNOTATION" as const
export const CONTENT_REMOVE_ANNOTATION_OVERLAY = "CONTENT_REMOVE_ANNOTATION_OVERLAY" as const
export const CLIPPER_GET_TASK_OPTIONS = "CLIPPER_GET_TASK_OPTIONS" as const
export const CLIPPER_CREATE_TASK = "CLIPPER_CREATE_TASK" as const
export const CLIPPER_CAPTURE_ANNOTATION_IMAGE = "CLIPPER_CAPTURE_ANNOTATION_IMAGE" as const

export type OpenSidePanelPayload = {
  annotationId: string
  url: string
  selectedText: string
  title?: string
  mode?: "highlight" | "line" | "box" | "underline"
}

export type StorageUpdatedPayload = {
  key: string
  urls?: string[]
  annotationIds?: string[]
}

export type SidepanelTaskCreatedPayload = {
  annotationId: string
  taskId: string
}

export type ContentToBackgroundMessage = {
  type: typeof CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION
  payload: OpenSidePanelPayload
}

export type ClipperTaskOptionsMessage = { type: typeof CLIPPER_GET_TASK_OPTIONS }

export type ClipperCreateTaskMessage = {
  type: typeof CLIPPER_CREATE_TASK
  payload: {
    annotationId: string
    title: string
    note: string
    selectedText: string
    pageUrl: string
    pageTitle: string
    mode: "highlight" | "line" | "box" | "underline"
    tableId: string
    assigneeEmail?: string
    dueDate?: string
    screenshotDataUrl?: string
  }
}

export type ClipperCaptureAnnotationImageMessage = {
  type: typeof CLIPPER_CAPTURE_ANNOTATION_IMAGE
  rect: { left: number; top: number; width: number; height: number }
  overlay?:
    | { kind: "box"; rect: { left: number; top: number; width: number; height: number } }
    | { kind: "line"; points: { x: number; y: number }[] }
}

export type ContentCommandMessage =
  | { type: typeof CONTENT_OPEN_SELECTION_CARD; mode?: "highlight" | "underline" }
  | { type: typeof CONTENT_ACTIVATE_DRAW_MODE; mode: "line" | "box" }
  | { type: typeof CONTENT_LOCATE_ANNOTATION; annotationId: string }
  | { type: typeof CONTENT_REMOVE_ANNOTATION_OVERLAY; annotationId: string }

export type BackgroundBroadcastMessage =
  | {
      type: typeof CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION
      payload: OpenSidePanelPayload
    }
  | { type: typeof STORAGE_UPDATED; payload: StorageUpdatedPayload }
  | {
      type: typeof SIDEPANEL_TASK_CREATED
      payload: SidepanelTaskCreatedPayload
    }

export const sendToBackground = async (msg: ContentToBackgroundMessage) =>
  await chrome.runtime.sendMessage(msg)

export const requestFromBackground = async <T>(
  msg: ClipperTaskOptionsMessage | ClipperCreateTaskMessage | ClipperCaptureAnnotationImageMessage
): Promise<T> => await chrome.runtime.sendMessage(msg)

export const broadcastFromExtension = async (msg: BackgroundBroadcastMessage) =>
  await chrome.runtime.sendMessage(msg)
