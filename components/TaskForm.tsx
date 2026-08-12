import * as Dialog from "@radix-ui/react-dialog"
import { useEffect, useMemo, useState } from "react"

import type { QTable, QTableUser } from "~utils/api"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  qt: QTable[]
  users: QTableUser[]
  selectedText: string
  defaultTitle?: string
  onSubmit: (input: {
    title: string
    assignee: string
    dueDate?: string
    tableId: string
  }) => Promise<void>
}

const defaultTitleFromText = (text: string) => {
  const t = text.trim().slice(0, 30)
  return t ? `审查 ‘${t}’` : "新建行动"
}

export function TaskForm({
  open,
  onOpenChange,
  qt,
  users,
  selectedText,
  defaultTitle: preferredTitle,
  onSubmit
}: Props) {
  const defaultTitle = useMemo(
    () => preferredTitle?.trim() || defaultTitleFromText(selectedText),
    [preferredTitle, selectedText]
  )
  const [title, setTitle] = useState(defaultTitle)
  const [assignee, setAssignee] = useState("")
  const [assigneeQuery, setAssigneeQuery] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [tableId, setTableId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle)
    setAssignee("")
    setAssigneeQuery("")
    setDueDate("")
    setTableId("")
    setError(null)
  }, [open, defaultTitle])

  const filteredUsers = users.filter((user) => {
    const query = assigneeQuery.trim().toLowerCase()
    return !query || `${user.name} ${user.email}`.toLowerCase().includes(query)
  }).slice(0, 8)

  const canSubmit = title.trim().length > 0 && tableId.trim().length > 0

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2147483646] bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[2147483647] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-slate-900">
                创建行动
              </Dialog.Title>
              <div className="mt-1 line-clamp-2 text-xs text-slate-500">
                {selectedText}
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                type="button">
                关闭
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="text-xs font-medium text-slate-500">行动标题</div>
              <input
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                onChange={(e) => setTitle(e.target.value)}
                value={title}
              />
              <div className="mt-1 text-xs text-slate-400">
                QNote 会将这条行动及其来源关系同步到 QTable
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">负责人（可搜索选择）</div>
              <div className="relative mt-1">
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={(e) => {
                    setAssigneeQuery(e.target.value)
                    setAssignee("")
                  }}
                  placeholder="搜索姓名或邮箱"
                  value={assigneeQuery}
                />
                {assigneeQuery && !assignee ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
                    {filteredUsers.map((user) => (
                      <button
                        className="block w-full px-2 py-1.5 text-left text-xs hover:bg-indigo-50"
                        key={user.id}
                        onClick={() => {
                          setAssignee(user.email)
                          setAssigneeQuery(`${user.name}（${user.email}）`)
                        }}
                        type="button">
                        <span className="font-medium text-slate-800">{user.name}</span>
                        <span className="ml-2 text-slate-500">{user.email}</span>
                      </button>
                    ))}
                    {filteredUsers.length === 0 ? <div className="px-2 py-1.5 text-xs text-slate-400">没有匹配用户</div> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-500">
                  截止日期
                </div>
                <input
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={(e) => setDueDate(e.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
              <button
                className="mb-[1px] rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                onClick={() => {
                  const d = new Date()
                  const yyyy = d.getFullYear()
                  const mm = String(d.getMonth() + 1).padStart(2, "0")
                  const dd = String(d.getDate()).padStart(2, "0")
                  setDueDate(`${yyyy}-${mm}-${dd}`)
                }}
                type="button">
                今天
              </button>
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-500">
                  目标行动表
                </div>
                <select
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400"
                  disabled={qt.length === 0}
                  onChange={(e) => setTableId(e.target.value)}
                  value={tableId}>
                  <option disabled value="">请选择目标表</option>
                  {qt.map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.emoji ? `${t.emoji} ` : "") + t.name} ({t.row_count})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              QNote 会在行动详情中保留网页链接、原文摘录和可回溯的批注来源。
            </div>
          </div>

          {error ? (
            <div className="mt-3 text-xs text-rose-600">{error}</div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                disabled={submitting}
                type="button">
                取消
              </button>
            </Dialog.Close>
            <button
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 active:bg-slate-700 disabled:opacity-60"
              disabled={!canSubmit || submitting}
              onClick={async () => {
                setSubmitting(true)
                setError(null)
                try {
                  await onSubmit({
                    title,
                    assignee,
                    dueDate: dueDate.trim() || undefined,
                    tableId
                  })
                  onOpenChange(false)
                } catch {
                  setError("创建失败，请重试")
                } finally {
                  setSubmitting(false)
                }
              }}
              type="button">
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  创建中…
                </span>
              ) : (
                "创建行动"
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
