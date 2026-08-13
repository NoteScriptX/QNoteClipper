import { useState } from "react"

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
}

type Props = {
  items: AnnotationPreview[]
  onCreateTask?: (annotationId: string) => void
  onStatusChange?: (annotationId: string, value: string) => Promise<void> | void
  onLocate?: (annotationId: string) => Promise<void> | void
  onUpdate?: (annotationId: string, input: { title: string; note: string }) => Promise<void> | void
  onDelete?: (annotationId: string) => Promise<void> | void
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

export function AnnotationList({ items, onCreateTask, onStatusChange, onLocate, onUpdate, onDelete }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center rounded border border-dashed border-slate-200 bg-white p-6 text-center">
        <div className="text-3xl">🗒️</div>
        <div className="mt-3 text-sm font-semibold text-slate-900">
          选中网页文字，即刻捕获并创建行动
        </div>
        <div className="mt-1 text-sm text-slate-500">
          松开鼠标后点击浮标，写下批注；需要时再创建可追踪行动。
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
        {items.map((it) => (
        <AnnotationListItem it={it} key={it.id} onCreateTask={onCreateTask} onStatusChange={onStatusChange} onLocate={onLocate} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
    </div>
  )
}

function AnnotationListItem({
  it,
  onCreateTask,
  onStatusChange,
  onLocate,
  onUpdate,
  onDelete
}: {
  it: AnnotationPreview
  onCreateTask?: (annotationId: string) => void
  onStatusChange?: (annotationId: string, value: string) => Promise<void> | void
  onLocate?: (annotationId: string) => Promise<void> | void
  onUpdate?: (annotationId: string, input: { title: string; note: string }) => Promise<void> | void
  onDelete?: (annotationId: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(it.title || "")
  const [note, setNote] = useState(it.note || "")
  const [busy, setBusy] = useState(false)
  const statusValue = it.task.kind === "created" ? it.task.statusValue : undefined
  const statusOption = it.task.kind === "created" ? it.task.statusOptions?.find((option) => option.id === statusValue || option.label === statusValue) : undefined
  const selectedStatusId = it.task.kind === "created" ? (statusOption?.id || it.task.statusOptions?.[0]?.id) : undefined
  const statusLabel = statusOption?.label || statusValue || (it.task.kind === "created" ? "待处理" : "待创建")
  const isDone = /完成|done|closed|关闭/i.test(statusLabel)
  const status = it.task.kind === "created"
    ? { line: isDone ? "bg-emerald-500" : "bg-indigo-500", pillClass: isDone ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-indigo-50 text-indigo-700 border-indigo-200" }
    : { line: "bg-amber-500", pillClass: "bg-amber-50 text-amber-800 border-amber-200" }

  return (
    <div
      className="group flex w-full cursor-pointer gap-3 rounded border border-slate-200 bg-white p-3 text-left hover:bg-slate-50"
      onClick={() => {
        if (!open) void onLocate?.(it.id)
        setOpen((v) => !v)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          if (!open) void onLocate?.(it.id)
          setOpen((v) => !v)
        }
      }}
      role="button"
      tabIndex={0}>
      <div className={`w-1 shrink-0 rounded ${status.line}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="line-clamp-2 text-sm font-semibold text-slate-900">
              {it.title || excerpt(it.selectedText)}
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-slate-500">
              {notePreview(it.note)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${status.pillClass}`}>
              {it.task.kind === "created" && it.task.statusOptions?.length && onStatusChange ? (
                <select
                  aria-label="行动状态"
                  className={`rounded-full border px-2 py-0.5 text-xs outline-none ${status.pillClass}`}
                  onChange={(e) => {
                    e.stopPropagation()
                    void onStatusChange(it.id, e.target.value)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  value={selectedStatusId || it.task.statusOptions[0].id}>
                  {it.task.statusOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              ) : statusLabel}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {formatRelativeTime(it.createdAt)}
            </div>
          </div>
        </div>

        {open ? (
          <div className="mt-3 rounded bg-white p-2">
            <div className="text-xs font-medium text-slate-500">完整批注</div>
            {editing ? (
              <div className="mt-2 space-y-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <input aria-label="批注标题" className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400" onChange={(event) => setTitle(event.target.value)} placeholder="批注标题" value={title} />
                <textarea aria-label="批注内容" className="min-h-20 w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-400" onChange={(event) => setNote(event.target.value)} placeholder="批注内容" value={note} />
                <div className="flex justify-end gap-2">
                  <button className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => { setTitle(it.title || ""); setNote(it.note || ""); setEditing(false) }} type="button">取消</button>
                  <button className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60" disabled={busy || !title.trim()} onClick={async () => { setBusy(true); try { await onUpdate?.(it.id, { title: title.trim(), note }); setEditing(false) } finally { setBusy(false) } }} type="button">{busy ? "保存中…" : "保存修改"}</button>
                </div>
              </div>
            ) : (
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                {(it.note ?? "").trim() || "（无）"}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-400">
              类型：{it.mode === "line" ? "手绘划线" : it.mode === "underline" ? "文字下划线" : it.mode === "box" ? "框选" : "文字高亮"}
            </div>
            {it.syncStatus === "error" ? (
              <div className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-700" title={it.syncError}>同步失败，将自动重试：{it.syncError || "QNote 暂时不可用"}</div>
            ) : it.syncStatus === "pending" || it.syncStatus === "syncing" ? (
              <div className="mt-2 text-xs text-amber-600">正在同步到 QNote…</div>
            ) : (
              <div className="mt-2 text-xs text-emerald-600">已同步到 QNote</div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="truncate text-xs text-slate-400">
                {it.pageTitle || "当前网页"}
              </div>
              <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                <button className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50" onClick={() => void onLocate?.(it.id)} type="button">定位原文</button>
                <button className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => setEditing(true)} type="button">编辑</button>
                <button className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-60" disabled={busy} onClick={async () => { if (!confirm("确定删除这条批注吗？已创建的 QTable 行动会保留。")) return; setBusy(true); try { await onDelete?.(it.id) } finally { setBusy(false) } }} type="button">删除</button>
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
                    已创建行动
                  </span>
                )
              ) : (
                <button
                  className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 active:bg-indigo-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreateTask?.(it.id)
                  }}
                  type="button">
                  创建行动
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {it.task.kind === "not_created" ? (
        <div className="shrink-0 self-center text-slate-400 group-hover:text-slate-600">
          ▸
        </div>
      ) : null}
    </div>
  )
}
