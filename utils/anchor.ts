export type TextAnchorFingerprint = {
  selectedText: string
  xpath: string
  prefix: string
  suffix: string
  context: string
}

const safeSliceAround = (
  text: string,
  start: number,
  end: number,
  ctxLen: number
) => {
  const beforeStart = Math.max(0, start - ctxLen)
  const afterEnd = Math.min(text.length, end + ctxLen)
  return {
    prefix: text.slice(beforeStart, start),
    suffix: text.slice(end, afterEnd)
  }
}

const isElement = (n: Node): n is Element => n.nodeType === Node.ELEMENT_NODE

export const getClosestElement = (node: Node | null): Element | null => {
  if (!node) return null
  if (isElement(node)) return node
  return (node as any).parentElement ?? null
}

export const getSimplifiedXPath = (el: Element): string => {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    const tag = cur.tagName.toLowerCase()
    const id = cur.getAttribute("id")
    if (id) {
      parts.unshift(`${tag}[@id='${id.replace(/'/g, "")}']`)
      break
    }

    const parent = cur.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }

    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName.toLowerCase() === tag
    )
    const idx = siblings.indexOf(cur) + 1
    parts.unshift(`${tag}[${idx}]`)
    cur = parent
  }
  return `//${parts.join("/")}`
}

export const elementByXPath = (xpath: string): Element | null => {
  try {
    const res = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    )
    const n = res.singleNodeValue
    return n && isElement(n) ? n : null
  } catch {
    return null
  }
}

export const createFingerprintFromRange = (
  range: Range
): TextAnchorFingerprint | null => {
  const rawSelectedText = range.toString()
  const selectedText = rawSelectedText.trim()
  if (!selectedText) return null

  const baseEl =
    getClosestElement(range.commonAncestorContainer) ??
    getClosestElement(range.startContainer)
  if (!baseEl) return null

  const containerText = baseEl.textContent ?? ""
  let idx = containerText.indexOf(selectedText)
  try {
    const before = document.createRange()
    before.selectNodeContents(baseEl)
    before.setEnd(range.startContainer, range.startOffset)
    idx = before.toString().length + rawSelectedText.indexOf(selectedText)
  } catch {
    // The quote/context fallback below remains usable if the DOM changed
    // between the selection event and fingerprint creation.
  }
  const ctx = safeSliceAround(
    containerText,
    idx >= 0 ? idx : 0,
    idx >= 0 ? idx + selectedText.length : 0,
    30
  )

  return {
    selectedText,
    xpath: getSimplifiedXPath(baseEl),
    prefix: ctx.prefix,
    suffix: ctx.suffix,
    context: containerText.slice(0, 260)
  }
}

export const createFingerprintFromSelection = (
  selection: Selection
): TextAnchorFingerprint | null => {
  if (!selection.rangeCount) return null
  return createFingerprintFromRange(selection.getRangeAt(0))
}

type LocatedText = {
  range: Range
  score: number
}

const scoreMatch = (
  full: string,
  start: number,
  end: number,
  fp: TextAnchorFingerprint
) => {
  const around = safeSliceAround(full, start, end, 30)
  let score = 0
  if (fp.prefix && around.prefix.endsWith(fp.prefix)) score += 2
  if (fp.suffix && around.suffix.startsWith(fp.suffix)) score += 2
  if (fp.context && full.includes(fp.context.slice(0, 80))) score += 1
  return score
}

const findBestInElement = (
  el: Element,
  fp: TextAnchorFingerprint
): LocatedText | null => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number; end: number }[] = []
  let full = ""
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest("script,style,noscript,#nsx-clipper-csui")) continue
    const value = node.nodeValue ?? ""
    if (!value) continue
    const start = full.length
    full += value
    nodes.push({ node, start, end: full.length })
  }

  const boundary = (offset: number, endBoundary: boolean) => {
    const entry = nodes.find((item) =>
      endBoundary ? offset > item.start && offset <= item.end : offset >= item.start && offset < item.end
    )
    if (!entry) return null
    return { node: entry.node, offset: Math.max(0, Math.min(entry.node.length, offset - entry.start)) }
  }

  let best: LocatedText | null = null
  const target = fp.selectedText
  if (!target || !nodes.length) return null
  let from = 0
  while (true) {
    const idx = full.indexOf(target, from)
    if (idx < 0) break
    const end = idx + target.length
    const startPoint = boundary(idx, false)
    const endPoint = boundary(end, true)
    if (startPoint && endPoint) {
      const score = scoreMatch(full, idx, end, fp)
      if (!best || score > best.score) {
        const range = document.createRange()
        range.setStart(startPoint.node, startPoint.offset)
        range.setEnd(endPoint.node, endPoint.offset)
        best = { range, score }
      }
    }
    from = idx + Math.max(1, target.length)
  }
  return best
}

export const locateRangeFromFingerprint = (
  fp: TextAnchorFingerprint
): { range: Range | null; status: "ok" | "maybe_lost" } => {
  try {
    const el = elementByXPath(fp.xpath)
    if (el) {
      const best = findBestInElement(el, fp)
      if (best) return { range: best.range, status: "ok" }
    }

    const bodyBest = findBestInElement(document.body, fp)
    if (bodyBest) return { range: bodyBest.range, status: "maybe_lost" }

    return { range: null, status: "maybe_lost" }
  } catch {
    return { range: null, status: "maybe_lost" }
  }
}

export const getMergedClientRects = (range: Range): DOMRect[] => {
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0
  )
  return rects
}
