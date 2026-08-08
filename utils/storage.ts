export const NSX_ANNOTATIONS_KEY = "nsx_annotations_v1"

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
  task?: {
    status: "created"
    taskId: string
    qtableUrl?: string
  }
  anchor: {
    xpath: string
    prefix: string
    suffix: string
    context: string
  }
  locateStatus?: "ok" | "maybe_lost"
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
  await chrome.storage.local.set({
    [NSX_ANNOTATIONS_KEY]: annotations
  })
}

export const getAnnotationsByUrl = async (
  url: string
): Promise<NsXAnnotation[]> => {
  const all = await getAllAnnotations()
  return all.filter((a) => a.url === url)
}

export const upsertAnnotation = async (
  annotation: NsXAnnotation
): Promise<void> => {
  const all = await getAllAnnotations()
  const next = [...all]
  const idx = next.findIndex((a) => a.id === annotation.id)
  if (idx >= 0) next[idx] = annotation
  else next.unshift(annotation)
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
  next[idx] = updater(next[idx])
  await setAllAnnotations(next)
}
