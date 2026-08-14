import { useEffect, useState } from "react"

import { Popconfirm } from "~components/Popconfirm"

export type AnnotationTaskStatus =
  | { kind: "not_created" }
  | {
      kind: "created"
      taskId: string
      qtableUrl?: string
      tableId?: string
      statusFieldId?: string
      statusFieldName?: string
      statusFieldType?: string
      statusValue?: string
      statusOptions?: { id: string; label: string }[]
    }

export type AnnotationPreview = {
  id: string
  selectedText: string
  title?: string
  mode?: "highlight" | "line" | "box" | "underline"
  note?: string
  createdAt: number
  task: AnnotationTaskStatus
  pageTitle?: string
  syncStatus?: "pending" | "syncing" | "synced" | "error"
  syncError?: string
  authorName?: string
}

type Props = {
  items: AnnotationPreview[]
  onCreateTask?: (annotationId: string) => void
  onStatusChange?: (annotationId: string, value: string) => Promise<void> | void
  onLocate?: (annotationId: string) => Promise<void> | void
  onUpdate?: (
    annotationId: string,
    input: { title: string; note: string }
  ) => Promise<void> | void
  onDelete?: (annotationId: string) => Promise<void> | void
  readOnly?: boolean
}

const excerpt = (text: string) => {
  const t = text.trim()
  if (!t) return "（空白行动）"
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

const notePreview = (note?: string) => {
  const t = (note ?? "").trim()
  if (!t) return "（无批注）"
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

const formatRelativeTime = (ts: number) => {
  const diffMs = Date.now() - ts
  if (diffMs < 30_000) return "刚刚"
  const min = Math.floor(diffMs / 60_000)
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(diffMs / 3_600_000)
  if (hour < 24) return `${hour}小时前`
  const day = Math.floor(diffMs / 86_400_000)
  if (day === 1) return "昨天"
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${mm}-${dd}`
}

export function AnnotationList({
  items,
  onCreateTask,
  onStatusChange,
  onLocate,
  onUpdate,
  onDelete,
  readOnly = false
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [items, selectedId])

  if (items.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center rounded border border-dashed border-slate-200 bg-white p-6 text-center">
        <div className="text-3xl">🗒️</div>
        <div className="mt-3 text-sm font-semibold text-slate-900">
          选中网页文字，即刻捕获并创建任务
        </div>
        <div className="mt-1 text-sm text-slate-500">
          松开鼠标后点击浮标，写下批注；需要时再创建可追踪任务。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <AnnotationListItem
          it={it}
          key={it.id}
          selected={selectedId === it.id}
          onSelect={(annotationId) => {
            setSelectedId(annotationId)
            void onLocate?.(annotationId)
          }}
          onCreateTask={onCreateTask}
          onStatusChange={onStatusChange}
          onUpdate={onUpdate}
          onDelete={onDelete}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

function AnnotationListItem({
  it,
  onCreateTask,
  onStatusChange,
  onUpdate,
  onDelete,
  readOnly,
  selected,
  onSelect
}: {
  it: AnnotationPreview
  selected: boolean
  onSelect: (annotationId: string) => void
  onCreateTask?: (annotationId: string) => void
  onStatusChange?: (annotationId: string, value: string) => Promise<void> | void
  onUpdate?: (
    annotationId: string,
    input: { title: string; note: string }
  ) => Promise<void> | void
  onDelete?: (annotationId: string) => Promise<void> | void
  readOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(it.title || "")
  const [note, setNote] = useState(it.note || "")
  const [busy, setBusy] = useState(false)
  const statusValue =
    it.task.kind === "created" ? it.task.statusValue : undefined
  const statusOption =
    it.task.kind === "created"
      ? it.task.statusOptions?.find(
          (option) => option.id === statusValue || option.label === statusValue
        )
      : undefined
  const selectedStatusId =
    it.task.kind === "created"
      ? statusOption?.id || it.task.statusOptions?.[0]?.id
      : undefined
  const statusLabel = statusOption?.label || statusValue || "待处理"
  const isDone = /完成|done|closed|关闭/i.test(statusLabel)
  const status =
    it.task.kind === "created"
      ? {
          line: isDone ? "bg-emerald-500" : "bg-indigo-500",
          pillClass: isDone
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-indigo-50 text-indigo-700 border-indigo-200"
        }
      : { line: "bg-slate-300", pillClass: "" }

  return (
    <div
      className={`group flex w-full gap-3 rounded-lg border p-3 text-left transition ${
        selected
          ? "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-100"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}>
      <div className={`w-1 shrink-0 rounded ${status.line}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <button
            aria-label={`选中并定位批注：${it.title || excerpt(it.selectedText)}`}
            aria-pressed={selected}
            className="min-w-0 flex-1 cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            onClick={() => onSelect(it.id)}
            title="选中并定位原文"
            type="button">
            <div className="line-clamp-2 text-sm font-semibold text-slate-900">
              {it.title || excerpt(it.selectedText)}
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-slate-500">
              {notePreview(it.note)}
            </div>
            {selected ? (
              <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-indigo-600">
                <span aria-hidden>⌖</span>
                已选中，点击可再次定位
              </div>
            ) : null}
          </button>
          <div className="flex shrink-0 items-start gap-1.5 text-right">
            <div>
              {it.task.kind === "created" ? (
                <div
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${status.pillClass}`}>
                  {it.task.statusOptions?.length && onStatusChange ? (
                    <select
                      aria-label="任务状态"
                      className={`rounded-full border px-2 py-0.5 text-xs outline-none ${status.pillClass}`}
                      onChange={(e) => {
                        e.stopPropagation()
                        void onStatusChange(it.id, e.target.value)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      value={selectedStatusId || it.task.statusOptions[0].id}>
                      {it.task.statusOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    statusLabel
                  )}
                </div>
              ) : null}
              <div className="mt-1 text-xs text-slate-400">
                {formatRelativeTime(it.createdAt)}
              </div>
            </div>
            <button
              aria-expanded={open}
              aria-label={open ? "收起批注详情" : "展开批注详情"}
              className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                open
                  ? "border-indigo-200 bg-indigo-100 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
              }`}
              onClick={() => setOpen((value) => !value)}
              title={open ? "收起详情" : "展开详情"}
              type="button">
              <svg
                aria-hidden
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 20 20">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>
        </div>

        {open ? (
          <div className="mt-3 rounded bg-white p-2">
            <div className="text-xs font-medium text-slate-500">完整批注</div>
            {editing ? (
              <div
                className="mt-2 space-y-2"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}>
                <input
                  aria-label="批注标题"
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="批注标题"
                  value={title}
                />
                <textarea
                  aria-label="批注内容"
                  className="min-h-20 w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="批注内容"
                  value={note}
                />
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => {
                      setTitle(it.title || "")
                      setNote(it.note || "")
                      setEditing(false)
                    }}
                    type="button">
                    取消
                  </button>
                  <button
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
                    disabled={busy || !title.trim()}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await onUpdate?.(it.id, { title: title.trim(), note })
                        setEditing(false)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    type="button">
                    {busy ? "保存中…" : "保存修改"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                {(it.note ?? "").trim() || "（无）"}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-400">
              {it.authorName ? `创建者：${it.authorName} · ` : ""}
              类型：
              {it.mode === "line"
                ? "手绘划线"
                : it.mode === "underline"
                  ? "文字下划线"
                  : it.mode === "box"
                    ? "框选"
                    : "文字高亮"}
            </div>
            {it.syncStatus === "error" ? (
              <div
                className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-700"
                title={it.syncError}>
                同步失败，将自动重试：{it.syncError || "QNote 暂时不可用"}
              </div>
            ) : it.syncStatus === "pending" || it.syncStatus === "syncing" ? (
              <div className="mt-2 text-xs text-amber-600">
                正在同步到 QNote…
              </div>
            ) : (
              <div className="mt-2 text-xs text-emerald-600">
                已同步到 QNote
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="truncate text-xs text-slate-400">
                {it.pageTitle || "当前网页"}
              </div>
              <div
                className="flex shrink-0 items-center gap-1"
                onClick={(event) => event.stopPropagation()}>
                <button
                  className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  onClick={() => onSelect(it.id)}
                  type="button">
                  定位原文
                </button>
                {!readOnly ? <>
                  <button
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => setEditing(true)}
                    type="button">
                    编辑
                  </button>
                  <Popconfirm
                  cancelText="取消"
                  description="已创建的 QTable 行动会保留。"
                  okText="删除"
                  okType="danger"
                  title="确定删除这条批注吗？"
                  onCancel={() => undefined}
                  onConfirm={async () => {
                    setBusy(true)
                    try {
                      await onDelete?.(it.id)
                    } finally {
                      setBusy(false)
                    }
                  }}
                  placement="bottom">
                  <button
                    className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                    disabled={busy}
                    type="button">
                    删除
                  </button>
                  </Popconfirm>
                </> : null}
              </div>
            </div>

            <div className="mt-2 flex justify-end">
              {it.task.kind === "created" ? (
                it.task.qtableUrl ? (
                  <a
                    className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                    href={it.task.qtableUrl}
                    onClick={(e) => e.stopPropagation()}
                    rel="noreferrer"
                    target="_blank">
                    在行动表中查看
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-slate-500">
                    已创建任务
                  </span>
                )
              ) : !readOnly ? (
                <button
                  className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 active:bg-indigo-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreateTask?.(it.id)
                  }}
                  type="button">
                  创建任务
                </button>
              ) : (
                <span className="text-xs text-slate-400">只读工作区</span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
