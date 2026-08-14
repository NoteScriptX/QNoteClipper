import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"
import { createPortal } from "react-dom"

type OkType = "primary" | "danger"

type Props = {
  title: React.ReactNode
  description?: React.ReactNode
  okText?: string
  cancelText?: string
  okType?: OkType
  placement?: "bottom" | "top"
  disabled?: boolean
  children: React.ReactElement
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

const okButtonClass: Record<OkType, string> = {
  primary: "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white",
  danger: "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white"
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

export function Popconfirm({
  title,
  description,
  okText = "确定",
  cancelText = "取消",
  okType = "primary",
  placement = "bottom",
  disabled = false,
  children,
  onConfirm,
  onCancel
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; actualPlacement: "bottom" | "top" } | null>(null)

  const computeCoords = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const popover = popoverRef.current
    const popoverHeight = popover?.offsetHeight ?? 0
    const popoverWidth = popover?.offsetWidth ?? 0
    const margin = 8
    const fitsBelow = rect.bottom + popoverHeight + margin <= window.innerHeight
    const fitsAbove = rect.top - popoverHeight - margin >= 0
    let actualPlacement = placement
    if (placement === "bottom" && !fitsBelow && fitsAbove) actualPlacement = "top"
    else if (placement === "top" && !fitsAbove && fitsBelow) actualPlacement = "bottom"

    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - popoverWidth - margin)
    )
    const top =
      actualPlacement === "bottom"
        ? rect.bottom + margin
        : rect.top - popoverHeight - margin
    setCoords({ top, left, actualPlacement })
  }, [placement])

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    computeCoords()
  }, [open, computeCoords])

  useEffect(() => {
    if (!open) return
    const handleDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
      onCancel?.()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        onCancel?.()
      }
    }
    const handleResize = () => computeCoords()
    document.addEventListener("mousedown", handleDocClick)
    document.addEventListener("keydown", handleKey)
    window.addEventListener("resize", handleResize)
    window.addEventListener("scroll", handleResize, true)
    return () => {
      document.removeEventListener("mousedown", handleDocClick)
      document.removeEventListener("keydown", handleKey)
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("scroll", handleResize, true)
    }
  }, [open, computeCoords, onCancel])

  const close = () => {
    setOpen(false)
    onCancel?.()
  }

  const handleConfirm = async () => {
    if (busy || !onConfirm) {
      close()
      return
    }
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node
          const childRef = (children as any).ref
          if (typeof childRef === "function") childRef(node)
          else if (childRef && typeof childRef === "object") childRef.current = node
        },
        onClick: (event: React.MouseEvent) => {
          const original = (children as any).props?.onClick as
            | ((e: React.MouseEvent) => void)
            | undefined
          original?.(event)
          if (event.defaultPrevented) return
          if (disabled) return
          event.preventDefault()
          event.stopPropagation()
          setOpen((v) => !v)
        }
      })
    : children

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="nsx-popover fixed z-50"
              ref={popoverRef}
              style={coords ? { top: coords.top, left: coords.left } : { visibility: "hidden", top: 0, left: 0 }}>
              <div
                className={`nsx-popover-arrow absolute h-2.5 w-2.5 rotate-45 border border-slate-200 bg-white ${
                  coords?.actualPlacement === "bottom"
                    ? "-top-1.5 left-4 border-b-0 border-r-0"
                    : "-bottom-1.5 left-4 border-t-0 border-l-0"
                }`}
              />
              <div className="min-w-56 max-w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-slate-900/5">
                <div className="flex items-start gap-2">
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      okType === "danger"
                        ? "bg-rose-50 text-rose-600"
                        : "bg-amber-50 text-amber-600"
                    }`}>
                    <svg
                      aria-hidden
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24">
                      <path
                        d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">
                      {title}
                    </div>
                    {description ? (
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {description}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                    disabled={busy}
                    onClick={close}
                    type="button">
                    {cancelText}
                  </button>
                  <button
                    className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-60 ${okButtonClass[okType]}`}
                    disabled={busy}
                    onClick={() => void handleConfirm()}
                    type="button">
                    {busy ? "处理中…" : okText}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
