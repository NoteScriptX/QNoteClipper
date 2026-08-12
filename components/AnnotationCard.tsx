import { useMemo, useState } from "react";
import type { QTable, QTableUser } from "~utils/api"





type Props = {
  x: number
  y: number
  arrowSide?: "left" | "right"
  selectedText: string
  pageTitle?: string
  initialNote?: string
  hasScreenshot?: boolean
  onClose: () => void
  onSave: (input: { title: string; note: string }) => Promise<void> | void
  taskOptions?: { tables: QTable[]; users: QTableUser[]; error?: string; loading: boolean }
  onCreateTask: (input: { title: string; note: string; tableId: string; assigneeEmail?: string; dueDate?: string }) => Promise<void> | void
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

export function AnnotationCard({
  x,
  y,
  arrowSide = "left",
  selectedText,
  pageTitle,
  initialNote,
  hasScreenshot = false,
  onClose,
  onSave,
  taskOptions,
  onCreateTask
}: Props) {
  const [note, setNote] = useState(initialNote ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [tableId, setTableId] = useState("")
  const [assigneeEmail, setAssigneeEmail] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [taskError, setTaskError] = useState<string | null>(null)

  const excerpt = useMemo(() => {
    const t = selectedText.trim()
    return t.length > 100 ? `${t.slice(0, 100)}…` : t
  }, [selectedText])

  const cardWidth = 420
  const padding = 12
  const left = clamp(x, padding, window.innerWidth - cardWidth - padding)
  const top = clamp(y, padding, window.innerHeight - 540 - padding)
  const tables = taskOptions?.tables ?? []
  const activeTableId = tableId

  return (
    <div
      className="pointer-events-auto relative w-[420px] rounded-xl border border-slate-200/90 bg-white/95 shadow-[0_14px_40px_rgba(15,23,42,0.16)] ring-1 ring-indigo-100/60 backdrop-blur-sm"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 2147483647
      }}>
      <div
        className={`absolute top-7 h-3 w-3 rotate-45 border border-slate-200/90 bg-white ${
          arrowSide === "left"
            ? "left-0 -translate-x-1/2"
            : "right-0 translate-x-1/2"
        }`}
      />

      <div className="p-4">
        <div className="rounded-lg border border-slate-100 bg-gradient-to-b from-slate-50 to-white p-2.5">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 text-slate-400">“</div>
            <div className="min-w-0">
              <div className="line-clamp-3 text-sm font-semibold text-slate-900">
                {excerpt || "（空）"}
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">
                来自 {pageTitle || "当前网页"}
              </div>
            </div>
            <button
              className="ml-auto shrink-0 rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-slate-200 hover:bg-white hover:text-slate-700"
              onClick={onClose}
              type="button">
              关闭
            </button>
          </div>
        </div>

        <div className="mt-3.5">
          <textarea
            autoFocus
            className="min-h-28 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (!e.ctrlKey) return
              if (e.key !== "Enter") return
              e.preventDefault()
              if (isSaving || isCreating || !note.trim()) return
              setIsSaving(true)
              Promise.resolve(onSave({ title: note.trim(), note: note.trim() }))
                .then(() => {
                  setSavedFlash(true)
                  setTimeout(() => onClose(), 260)
                })
                .finally(() => {
                  setTimeout(() => setIsSaving(false), 260)
                })
            }}
            placeholder="批注内容（必填，也可作为行动标题）"
            value={note}
          />
          <div className="mt-1.5 text-[11px] text-slate-400">
            提示：按 Ctrl + Enter 可快速保存
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-600">
            目标行动表
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-indigo-400"
              disabled={taskOptions?.loading || tables.length === 0}
              onChange={(e) => setTableId(e.target.value)}
              value={activeTableId}>
              {tables.length ? <>
                <option disabled value="">请选择目标表</option>
                {tables.map((table) => <option key={table.id} value={table.id}>{table.name}（{table.row_count}）</option>)}
              </> : <option value="">{taskOptions?.loading ? "加载行动选项…" : "暂无可用行动表"}</option>}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            负责人（可搜索）
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-indigo-400"
              list={`nsx-users-${Math.round(x)}-${Math.round(y)}`}
              onChange={(e) => setAssigneeEmail(e.target.value)}
              placeholder="姓名或邮箱"
              value={assigneeEmail}
            />
            <datalist id={`nsx-users-${Math.round(x)}-${Math.round(y)}`}>
              {(taskOptions?.users ?? []).map((user) => <option key={user.id} label={user.name} value={user.email}>{user.name}</option>)}
            </datalist>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            截止日期
            <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-indigo-400" onChange={(e) => setDueDate(e.target.value)} type="date" value={dueDate} />
          </label>
          <div className="flex items-end rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            已自动附上来源链接
          </div>
        </div>
        {taskOptions?.error ? <div className="mt-2 text-xs text-rose-600">{taskOptions.error}</div> : null}
        {taskError ? <div className="mt-2 text-xs text-rose-600">{taskError}</div> : null}
        {hasScreenshot ? <div className="mt-2 text-xs text-slate-500">已附上当前绘制区域截图，QNote 会保存截图并在行动中保留来源引用。</div> : null}

        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60"
            disabled={isSaving || isCreating || !note.trim()}
            onClick={async () => {
              setIsSaving(true)
              try {
                await onSave({ title: note.trim(), note: note.trim() })
                setSavedFlash(true)
                setTimeout(() => onClose(), 260)
              } finally {
                setTimeout(() => setIsSaving(false), 260)
              }
            }}
            type="button">
            {savedFlash ? "已保存 ✓" : isSaving ? "保存中…" : "保存批注"}
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60"
            disabled={isSaving || isCreating || !note.trim() || !activeTableId || taskOptions?.loading}
            onClick={async () => {
              setIsCreating(true)
              try {
                setTaskError(null)
                await onCreateTask({ title: note.trim(), note: note.trim(), tableId: activeTableId, assigneeEmail: assigneeEmail.trim() || undefined, dueDate: dueDate || undefined })
                onClose()
              } catch (error) {
                setTaskError(error instanceof Error ? error.message : "创建行动失败")
              } finally {
                setIsCreating(false)
              }
            }}
            type="button">
            {isCreating ? "创建中…" : "保存并创建行动"}
          </button>
        </div>
      </div>
    </div>
  )
}
