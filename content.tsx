import cssText from "data-text:~style.css";
import type { PlasmoCSConfig, PlasmoGetShadowHostId, PlasmoGetStyle } from "plasmo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";



import { AnnotationCard } from "~components/AnnotationCard";
import { Bubble } from "~components/Bubble";
import { createFingerprintFromRange, createFingerprintFromSelection, getMergedClientRects, locateRangeFromFingerprint } from "~utils/anchor";
import { CLIPPER_CAPTURE_ANNOTATION_IMAGE, CONTENT_ACTIVATE_DRAW_MODE, CONTENT_OPEN_SELECTION_CARD, requestFromBackground, STORAGE_UPDATED } from "~utils/messaging";
import { getAnnotationsByUrl, normalizePageUrl, NSX_ANNOTATIONS_KEY, upsertAnnotation, type AnnotationMode, type NsXAnnotation } from "~utils/storage";





export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: false
}

export const getShadowHostId: PlasmoGetShadowHostId = () => "nsx-clipper-csui"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

type BubbleState =
  | {
      visible: false
    }
  | {
      visible: true
      x: number
      y: number
      selectionText: string
    }

type HighlightRect = {
  id: string
  rects: DOMRect[]
  status: "ok" | "maybe_lost"
  mode: AnnotationMode
  box?: { left: number; top: number; width: number; height: number }
  line?: { x: number; y: number }[]
}

type DraftAnnotation = {
  id: string
  url: string
  pageTitle: string
  createdAt: number
  selectedText: string
  anchor: NsXAnnotation["anchor"]
  locateStatus: "ok" | "maybe_lost"
  mode: AnnotationMode
  box?: { left: number; top: number; width: number; height: number }
  line?: { x: number; y: number }[]
  shapeAnchor?: { left: number; top: number; width: number; height: number }
  screenshotDataUrl?: string
}

type Box = { left: number; top: number; width: number; height: number }

const normalizeBox = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y)
})

const rectsIntersect = (a: DOMRect, b: Box) =>
  a.right >= b.left && a.left <= b.left + b.width && a.bottom >= b.top && a.top <= b.top + b.height

const getTextAndRangeInBox = (box: Box): { text: string; range: Range | null } => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const chunks: string[] = []
  let firstRange: Range | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const parent = node.parentElement
    if (!parent || parent.closest("#nsx-clipper-csui,script,style,noscript")) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = Array.from(range.getClientRects())
    if (!rects.some((rect) => rectsIntersect(rect, box))) continue
    const value = (node.nodeValue || "").trim()
    if (value) {
      chunks.push(value)
      if (!firstRange) firstRange = range
    }
  }
  return { text: chunks.join(" ").trim().slice(0, 4000), range: firstRange }
}

const getDocumentBounds = (range: Range): Box | null => {
  const rects = getMergedClientRects(range)
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.left)) + window.scrollX
  const top = Math.min(...rects.map((rect) => rect.top)) + window.scrollY
  const right = Math.max(...rects.map((rect) => rect.right)) + window.scrollX
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + window.scrollY
  return { left, top, width: right - left, height: bottom - top }
}

type CardState =
  | { visible: false }
  | {
      visible: true
      x: number
      y: number
      arrowSide: "left" | "right"
      draft: DraftAnnotation
    }

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

const shouldIgnoreSelection = (selection: Selection): boolean => {
  const node = selection.anchorNode
  if (!node) return false
  const root = (node as any).getRootNode?.()
  if (root && root instanceof ShadowRoot) {
    const host = root.host as HTMLElement | null
    if (host?.id === "nsx-clipper-csui") return true
  }
  const el = (node as any).parentElement ?? null
  if (!el) return false
  return Boolean(
    (el as Element).closest(
      "input,textarea,select,option,pre,code,kbd,samp,script,style"
    )
  )
}

const getSelectionRect = (selection: Selection): DOMRect | null => {
  if (!selection.rangeCount) return null
  const r = selection.getRangeAt(0)
  const rect = r.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) return rect
  const rects = Array.from(r.getClientRects())
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((x) => x.left))
  const top = Math.min(...rects.map((x) => x.top))
  const right = Math.max(...rects.map((x) => x.right))
  const bottom = Math.max(...rects.map((x) => x.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

const computeBubblePosition = (rect: DOMRect) => {
  const bubbleSize = 28
  const padding = 8
  const yMid = clamp(
    rect.top + rect.height / 2 - bubbleSize / 2,
    padding,
    window.innerHeight - bubbleSize - padding
  )

  const xRight = rect.right + padding
  if (xRight + bubbleSize + padding <= window.innerWidth) {
    return { x: xRight, y: yMid }
  }

  const xLeft = rect.left - padding - bubbleSize
  if (xLeft >= padding) {
    return { x: xLeft, y: yMid }
  }

  const xBelow = clamp(
    rect.left,
    padding,
    window.innerWidth - bubbleSize - padding
  )
  const yBelow = clamp(
    rect.bottom + padding,
    padding,
    window.innerHeight - bubbleSize - padding
  )
  return { x: xBelow, y: yBelow }
}

const computeCardPositionFromBubble = (bubble: {
  x: number
  y: number
}): { x: number; y: number; arrowSide: "left" | "right" } => {
  const bubbleSize = 28
  const cardWidth = 300
  const estimatedHeight = 360
  const padding = 12
  const preferRight = bubble.x + bubbleSize + 8
  const preferLeft = bubble.x - 8 - cardWidth
  const canRight = preferRight + cardWidth + padding <= window.innerWidth
  const canLeft = preferLeft >= padding
  const x = canRight
    ? preferRight
    : canLeft
      ? preferLeft
      : clamp(preferRight, padding, window.innerWidth - cardWidth - padding)

  const y = clamp(
    bubble.y - 20,
    padding,
    window.innerHeight - estimatedHeight - padding
  )

  return { x, y, arrowSide: canRight ? "left" : canLeft ? "right" : "left" }
}

const genId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `a_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

export default function Content() {
  const [bubble, setBubble] = useState<BubbleState>({ visible: false })
  const [card, setCard] = useState<CardState>({ visible: false })
  const [highlights, setHighlights] = useState<HighlightRect[]>([])
  const [ephemeralRects, setEphemeralRects] = useState<DOMRect[]>([])
  const [boxPreview, setBoxPreview] = useState<Box | null>(null)
  const [linePreview, setLinePreview] = useState<{ x: number; y: number }[] | null>(null)
  const rafRef = useRef<number | null>(null)
  const ephemeralTimerRef = useRef<number | null>(null)
  const ephemeralRectsRef = useRef<DOMRect[]>([])
  const drawModeRef = useRef<"line" | "box" | null>(null)
  const boxStartRef = useRef<{ x: number; y: number } | null>(null)
  const linePointsRef = useRef<{ x: number; y: number }[] | null>(null)
  const traceHandledRef = useRef(false)

  const url = useMemo(() => normalizePageUrl(window.location.href), [])
  const traceAnnotationId = useMemo(() => {
    try {
      return new URL(window.location.href).searchParams.get("qnote_annotation")
    } catch {
      return null
    }
  }, [])

  const captureAnnotationImage = useCallback(async (rect: Box, overlay?: { kind: "box"; rect: Box } | { kind: "line"; points: { x: number; y: number }[] }): Promise<string | undefined> => {
    const response = await requestFromBackground<{ ok: boolean; dataUrl?: string }>({ type: CLIPPER_CAPTURE_ANNOTATION_IMAGE, rect, overlay })
    return response.ok ? response.dataUrl : undefined
  }, [])

  const refreshHighlights = useCallback(async () => {
    try {
      const annotations = await getAnnotationsByUrl(url)
      const next: HighlightRect[] = []
      for (const a of annotations) {
        const located = a.mode === "line" || a.mode === "box" ? locateRangeFromFingerprint({
          selectedText: a.selectedText,
          xpath: a.anchor.xpath,
          prefix: a.anchor.prefix,
          suffix: a.anchor.suffix,
          context: a.anchor.context
        }) : null
        const currentAnchor = located?.range ? getDocumentBounds(located.range) : null
        if (!traceHandledRef.current && traceAnnotationId && a.serverId === traceAnnotationId && located?.range) {
          located.range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" })
          traceHandledRef.current = true
        }
        if (a.mode === "line" && a.line?.length) {
          const line = a.shapeAnchor && currentAnchor
            ? a.line.map((point) => ({ x: currentAnchor.left + point.x - a.shapeAnchor.left, y: currentAnchor.top + point.y - a.shapeAnchor.top }))
            : a.line
          next.push({ id: a.id, rects: [], status: located?.status || "ok", mode: "line", line })
          continue
        }
        if (a.mode === "box" && a.box) {
          const box = a.shapeAnchor && currentAnchor
            ? { left: currentAnchor.left + a.box.left - a.shapeAnchor.left, top: currentAnchor.top + a.box.top - a.shapeAnchor.top, width: a.box.width, height: a.box.height }
            : a.box
          next.push({ id: a.id, rects: [], status: located?.status || "ok", mode: "box", box })
          continue
        }
        const textLocated = locateRangeFromFingerprint({
          selectedText: a.selectedText,
          xpath: a.anchor.xpath,
          prefix: a.anchor.prefix,
          suffix: a.anchor.suffix,
          context: a.anchor.context
        })
        if (!textLocated.range) {
          next.push({ id: a.id, rects: [], status: textLocated.status, mode: a.mode === "underline" ? "underline" : "highlight" })
          continue
        }
        next.push({
          id: a.id,
          rects: getMergedClientRects(textLocated.range),
          status: textLocated.status,
          mode: a.mode === "underline" ? "underline" : "highlight"
        })
      }
      setHighlights(next)
    } catch {
      // ignore
    }
  }, [traceAnnotationId, url])

  useEffect(() => {
    refreshHighlights()
  }, [card.visible, refreshHighlights])

  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type !== STORAGE_UPDATED) return
      const p = message.payload
      if (p?.key !== NSX_ANNOTATIONS_KEY) return
      if (p.urls && !p.urls.includes(url)) return
      refreshHighlights()
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [refreshHighlights, url])

  useEffect(() => {
    const isInCsui = (e: MouseEvent) => {
      const path = e.composedPath?.() ?? []
      return path.some((p) => {
        if (p instanceof HTMLElement) return p.id === "nsx-clipper-csui"
        if (p instanceof ShadowRoot) {
          return (p.host as HTMLElement | null)?.id === "nsx-clipper-csui"
        }
        return false
      })
    }

    const onMouseUp = async (e: MouseEvent) => {
      if (card.visible) return
      if (isInCsui(e)) return
      if (boxStartRef.current) {
        e.preventDefault()
        const start = boxStartRef.current
        boxStartRef.current = null
        const box = normalizeBox(start, { x: e.clientX, y: e.clientY })
        drawModeRef.current = null
        document.documentElement.style.cursor = ""
        if (box.width < 12 || box.height < 12) {
          setBoxPreview(null)
          return
        }
        const captured = getTextAndRangeInBox(box)
        const fingerprint = captured.range ? createFingerprintFromRange(captured.range) : null
        const shapeAnchor = captured.range ? getDocumentBounds(captured.range) : undefined
        const docBox = { left: box.left + window.scrollX, top: box.top + window.scrollY, width: box.width, height: box.height }
        const screenshotDataUrl = await captureAnnotationImage(box, { kind: "box", rect: box }).catch(() => undefined)
        setBoxPreview(null)
        const draft: DraftAnnotation = {
          id: genId(), url, pageTitle: document.title || "", createdAt: Date.now(),
          selectedText: captured.text || "页面框选", anchor: fingerprint || { selectedText: captured.text || "页面框选", xpath: "", prefix: "", suffix: "", context: "" }, locateStatus: "ok", mode: "box", box: docBox, shapeAnchor, screenshotDataUrl
        }
        const cardPos = computeCardPositionFromBubble({ x: box.left, y: box.top })
        setCard({ visible: true, x: cardPos.x, y: cardPos.y, arrowSide: cardPos.arrowSide, draft })
        return
      }
      if (linePointsRef.current) {
        e.preventDefault()
        const points = linePointsRef.current
        linePointsRef.current = null
        drawModeRef.current = null
        document.documentElement.style.cursor = ""
        if (points.length < 2) {
          setLinePreview(null)
          return
        }
        const bounds = {
          left: Math.min(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
          height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
        }
        const captured = getTextAndRangeInBox(bounds)
        const fingerprint = captured.range ? createFingerprintFromRange(captured.range) : null
        const shapeAnchor = captured.range ? getDocumentBounds(captured.range) : undefined
        const screenshotDataUrl = await captureAnnotationImage(bounds, { kind: "line", points }).catch(() => undefined)
        setLinePreview(null)
        const draft: DraftAnnotation = {
          id: genId(), url, pageTitle: document.title || "", createdAt: Date.now(),
          selectedText: captured.text || "手绘划线", anchor: fingerprint || { selectedText: captured.text || "手绘划线", xpath: "", prefix: "", suffix: "", context: "" },
          locateStatus: "ok", mode: "line",
          line: points.map((point) => ({ x: point.x + window.scrollX, y: point.y + window.scrollY })), shapeAnchor, screenshotDataUrl
        }
        const cardPos = computeCardPositionFromBubble({ x: points[0].x, y: points[0].y })
        setCard({ visible: true, x: cardPos.x, y: cardPos.y, arrowSide: cardPos.arrowSide, draft })
        return
      }
      const selection = window.getSelection()
      if (!selection) return
      setCard({ visible: false })
      const selected = selection.toString().trim()
      if (!selected) {
        setBubble({ visible: false })
        return
      }
      if (shouldIgnoreSelection(selection)) {
        setBubble({ visible: false })
        return
      }
      const rect = getSelectionRect(selection)
      if (!rect) return
      const pos = computeBubblePosition(rect)
      setBubble({
        visible: true,
        x: pos.x,
        y: pos.y,
        selectionText: selected
      })
    }

    const onScrollOrResize = () => {
      setBubble({ visible: false })
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        refreshHighlights()
      })
    }

    const onMouseDown = (e: MouseEvent) => {
      if (isInCsui(e)) {
        return
      }
      if (drawModeRef.current === "box") {
        e.preventDefault()
        boxStartRef.current = { x: e.clientX, y: e.clientY }
        setBoxPreview({ left: e.clientX, top: e.clientY, width: 0, height: 0 })
        return
      }
      if (drawModeRef.current === "line") {
        e.preventDefault()
        linePointsRef.current = [{ x: e.clientX, y: e.clientY }]
        setLinePreview(linePointsRef.current)
        return
      }
      if (ephemeralTimerRef.current != null) {
        window.clearTimeout(ephemeralTimerRef.current)
        ephemeralTimerRef.current = null
      }
      if (card.visible) {
        setEphemeralRects(ephemeralRectsRef.current)
        ephemeralTimerRef.current = window.setTimeout(() => {
          ephemeralRectsRef.current = []
          setEphemeralRects([])
          ephemeralTimerRef.current = null
        }, 2500)
      } else {
        ephemeralRectsRef.current = []
        setEphemeralRects([])
      }
      setBubble({ visible: false })
      setCard({ visible: false })
    }

    document.addEventListener("mouseup", onMouseUp, true)
    document.addEventListener("mousedown", onMouseDown, true)
    const onMouseMove = (e: MouseEvent) => {
      if (boxStartRef.current || linePointsRef.current) e.preventDefault()
      const start = boxStartRef.current
      if (start) setBoxPreview(normalizeBox(start, { x: e.clientX, y: e.clientY }))
      const line = linePointsRef.current
      if (!line) return
      const next = [...line, { x: e.clientX, y: e.clientY }]
      linePointsRef.current = next.length > 500 ? next.slice(-500) : next
      setLinePreview(linePointsRef.current)
    }
    document.addEventListener("mousemove", onMouseMove, true)
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize, true)

    return () => {
      document.removeEventListener("mouseup", onMouseUp, true)
      document.removeEventListener("mousedown", onMouseDown, true)
      document.removeEventListener("mousemove", onMouseMove, true)
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize, true)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (ephemeralTimerRef.current != null) {
        window.clearTimeout(ephemeralTimerRef.current)
        ephemeralTimerRef.current = null
      }
    }
  }, [card.visible, captureAnnotationImage, refreshHighlights])

  const onBubbleClick = useCallback(async () => {
    const selection = window.getSelection()
    if (!selection) return
    if (!selection.rangeCount) return
    const fp = createFingerprintFromSelection(selection)
    if (!fp) return

    setBubble({ visible: false })
    const r = selection.getRangeAt(0)
    const rects = getMergedClientRects(r)
    ephemeralRectsRef.current = rects
    setEphemeralRects(rects)
    if (ephemeralTimerRef.current != null) {
      window.clearTimeout(ephemeralTimerRef.current)
      ephemeralTimerRef.current = null
    }
    const selectionRect = getSelectionRect(selection)
    const fallbackBubble = selectionRect ? computeBubblePosition(selectionRect) : null
    const pos = bubble.visible
      ? computeCardPositionFromBubble({ x: bubble.x, y: bubble.y })
      : fallbackBubble
        ? computeCardPositionFromBubble(fallbackBubble)
        : { x: 12, y: 12, arrowSide: "left" as const }
    const draft: DraftAnnotation = {
      id: genId(),
      url,
      pageTitle: document.title || "",
      createdAt: Date.now(),
      selectedText: fp.selectedText,
      anchor: {
        xpath: fp.xpath,
        prefix: fp.prefix,
        suffix: fp.suffix,
        context: fp.context
      },
      locateStatus: "ok",
      mode: "highlight"
    }

    selection.removeAllRanges()
    setCard({
      visible: true,
      x: pos.x,
      y: pos.y,
      arrowSide: pos.arrowSide,
      draft
    })
  }, [bubble, url])

  useEffect(() => {
    const listener = (message: { type?: string; mode?: "line" | "box" }) => {
      if (message.type === CONTENT_OPEN_SELECTION_CARD) {
        void onBubbleClick()
        return
      }
      if (message.type === CONTENT_ACTIVATE_DRAW_MODE && message.mode) {
        setBubble({ visible: false })
        setCard({ visible: false })
        window.getSelection()?.removeAllRanges()
        drawModeRef.current = message.mode
        document.documentElement.style.cursor = message.mode === "line" ? "crosshair" : "cell"
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [onBubbleClick])

  useEffect(() => {
    const cancelDrawing = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drawModeRef.current) return
      drawModeRef.current = null
      boxStartRef.current = null
      linePointsRef.current = null
      setBoxPreview(null)
      setLinePreview(null)
      document.documentElement.style.cursor = ""
    }
    window.addEventListener("keydown", cancelDrawing, true)
    return () => window.removeEventListener("keydown", cancelDrawing, true)
  }, [])

  const saveDraft = useCallback(
    async (draft: DraftAnnotation, input: { title: string; note: string }) => {
      try {
        const annotation: NsXAnnotation = {
          id: draft.id,
          url: draft.url,
          pageTitle: draft.pageTitle,
          createdAt: draft.createdAt,
          selectedText: draft.selectedText,
          title: input.title.trim(),
          note: input.note,
      mode: draft.mode,
      box: draft.box,
      line: draft.line,
      shapeAnchor: draft.shapeAnchor,
      screenshotDataUrl: draft.screenshotDataUrl,
          anchor: draft.anchor,
          locateStatus: draft.locateStatus
        }
        await upsertAnnotation(annotation)
        await refreshHighlights()
      } catch {
        // ignore
      }
    },
    [refreshHighlights]
  )

  return (
    <div className="pointer-events-none">
      <div
        className="pointer-events-none"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483646
        }}>
        {highlights.flatMap((h) => {
          if (h.mode === "line" && h.line?.length) {
            const points = h.line.map((point) => `${point.x - window.scrollX},${point.y - window.scrollY}`).join(" ")
            return [<svg key={h.id} className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex: 2147483645 }}><polyline fill="none" points={points} stroke="#ef4444" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" /></svg>]
          }
          if (h.mode === "box" && h.box) {
            return [
              <div key={h.id} className="pointer-events-none border-2 border-indigo-500 bg-indigo-100/20" style={{ position: "absolute", left: h.box.left - window.scrollX, top: h.box.top - window.scrollY, width: h.box.width, height: h.box.height }} />
            ]
          }
          return h.rects.map((r, idx) => (
            <mark
              key={`${h.id}_${idx}`}
              className={`pointer-events-none ${h.mode === "underline" ? "border-b-2 border-red-500 bg-transparent" : "rounded bg-yellow-300/60"}`}
              style={{ position: "fixed", left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ))
        })}
        {ephemeralRects.map((r, idx) => (
          <mark
            key={`ephemeral_${idx}`}
            className="pointer-events-none rounded bg-indigo-200/60"
            style={{
              position: "fixed",
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height
            }}
          />
        ))}
      </div>

      {bubble.visible ? (
        <Bubble x={bubble.x} y={bubble.y} onClick={onBubbleClick} />
      ) : null}

      {card.visible ? (
        <AnnotationCard
          initialNote=""
          hasScreenshot={Boolean(card.draft.screenshotDataUrl)}
          onClose={() => {
            drawModeRef.current = null
            document.documentElement.style.cursor = ""
            setCard({ visible: false })
          }}
          onSave={async (input) => {
            const draft = card.draft
            await saveDraft(draft, input)
          }}
          arrowSide={card.arrowSide}
          pageTitle={card.draft.pageTitle}
          selectedText={card.draft.selectedText}
          x={card.x}
          y={card.y}
        />
      ) : null}
      {boxPreview ? (
        <div className="pointer-events-none fixed border-2 border-indigo-500 bg-indigo-200/20" style={{ left: boxPreview.left, top: boxPreview.top, width: boxPreview.width, height: boxPreview.height, zIndex: 2147483645 }} />
      ) : null}
        {linePreview && linePreview.length > 1 ? (
        <svg className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex: 2147483645 }}>
          <polyline fill="none" points={linePreview.map((point) => `${point.x},${point.y}`).join(" ")} stroke="#ef4444" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </svg>
        ) : null}
      {card.visible && card.draft.box ? (
        <div className="pointer-events-none fixed border-2 border-indigo-500 bg-indigo-200/20" style={{ left: card.draft.box.left - window.scrollX, top: card.draft.box.top - window.scrollY, width: card.draft.box.width, height: card.draft.box.height, zIndex: 2147483645 }} />
      ) : null}
      {card.visible && card.draft.line && card.draft.line.length > 1 ? (
        <svg className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex: 2147483645 }}>
          <polyline fill="none" points={card.draft.line.map((point) => `${point.x - window.scrollX},${point.y - window.scrollY}`).join(" ")} stroke="#ef4444" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </svg>
      ) : null}
    </div>
  )
}
