import { useCallback, useEffect, useMemo, useRef, useState } from "react";






import "~style.css";



import { AnnotationList, type AnnotationPreview } from "~components/AnnotationList";
import { TaskForm } from "~components/TaskForm";
import { createTaskFromAnnotation, getQtables, getQtableUsers, type QTable, type QTableUser } from "~utils/api";
import { CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION, STORAGE_UPDATED, type BackgroundBroadcastMessage, type OpenSidePanelPayload } from "~utils/messaging";
import { getSettings, patchSettings, type NsXSettings } from "~utils/settings";
import { getAnnotationById, getAnnotationsByUrl, NSX_ANNOTATIONS_KEY, updateAnnotationById } from "~utils/storage";
import { getAuthState } from "~utils/auth";





type PageInfo = {
  title: string
  url: string
  faviconUrl?: string
}

const getCurrentPageInfo = async (): Promise<PageInfo> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return {
    title: tab?.title ?? "",
    url: tab?.url ?? "",
    faviconUrl: tab?.favIconUrl ?? undefined
  }
}

const shortUrl = (url: string) => {
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return url
  }
}

export default function SidePanel() {
  const [pageInfo, setPageInfo] = useState<PageInfo>({ title: "", url: "" })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pending, setPending] = useState<OpenSidePanelPayload | null>(null)
  const [items, setItems] = useState<AnnotationPreview[]>([])
  const [qtables, setQtables] = useState<QTable[]>([])
  const [qtableUsers, setQtableUsers] = useState<QTableUser[]>([])
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"annotations" | "settings">(
    "annotations"
  )
  const [settings, setSettings] = useState<NsXSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pageCollapsed, setPageCollapsed] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const successTimerRef = useRef<number | null>(null)

  const pendingText = pending?.selectedText ?? ""
  const domain = useMemo(
    () => (pageInfo.url ? shortUrl(pageInfo.url) : ""),
    [pageInfo.url]
  )

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)
    try {
      // Check auth state first
      const authState = await getAuthState()
      
      const info = await getCurrentPageInfo()
      setPageInfo(info)

      const st = await getSettings()
      if (!authState.isAuthenticated) {
        setSettings({ ...st, loggedIn: false })
        setQtables([])
        setItems([])
        return
      }

      const qts = await getQtables()
      setQtables(qts)
      setQtableUsers(await getQtableUsers())

      setSettings(st)

      const annotations = await getAnnotationsByUrl(info.url)
      const nextItems: AnnotationPreview[] = annotations.map((a) => ({
        id: a.id,
        selectedText: a.selectedText ?? "",
        title: a.title,
        mode: a.mode,
        note: a.note,
        createdAt: a.createdAt,
        pageTitle: a.pageTitle,
        task:
          a.task?.status === "created"
            ? {
                kind: "created",
                taskId: a.task.taskId,
                qtableUrl: a.task.qtableUrl
              }
            : { kind: "not_created" }
      }))
      setItems(nextItems)
    } catch (err) {
      if (err instanceof Error && err.message.includes("Not authenticated")) {
        setError("登录已过期，请重新登录")
        await patchSettings({ loggedIn: false })
        setSettings(await getSettings())
      } else {
        setError("加载失败，请重试")
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for auth state changes from background script
  useEffect(() => {
    const handleAuthMessage = (message: any) => {
      if (message?.type === "AUTH_STATE_CHANGED") {
        // Refresh settings to get updated user info
        refresh()
        if (pending) {
          setActiveTab("annotations")
          setTaskDialogOpen(true)
        }
        setIsLoggingIn(false)
        setSuccess("登录成功")
      }
      if (message?.type === "AUTH_ERROR") {
        const errorMsg = message.error || "登录失败"
        setError(errorMsg)
        setIsLoggingIn(false)
        
        // Provide specific guidance for common errors
        if (errorMsg.includes("user_cancelled")) {
          setError("您取消了登录")
        } else if (errorMsg.includes("redirect_uri_mismatch")) {
          setError("OAuth配置错误，请联系管理员")
        }
      }
    }
    chrome.runtime.onMessage.addListener(handleAuthMessage)
    return () => chrome.runtime.onMessage.removeListener(handleAuthMessage)
  }, [pending, refresh])

  useEffect(() => {
    if (!success) return
    if (successTimerRef.current != null) {
      window.clearTimeout(successTimerRef.current)
      successTimerRef.current = null
    }
    successTimerRef.current = window.setTimeout(() => {
      setSuccess(null)
      successTimerRef.current = null
    }, 3000)
    return () => {
      if (successTimerRef.current != null) {
        window.clearTimeout(successTimerRef.current)
        successTimerRef.current = null
      }
    }
  }, [success])

  useEffect(() => {
    const listener = (message: BackgroundBroadcastMessage) => {
      if (message?.type === CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION) {
        setPending(message.payload)
        if (settings?.loggedIn !== false) setTaskDialogOpen(true)
        else setActiveTab("settings")
        return
      }

      if (message?.type === STORAGE_UPDATED) {
        const p = message.payload
        if (p?.key !== NSX_ANNOTATIONS_KEY) return
        if (p.urls && pageInfo.url && !p.urls.includes(pageInfo.url)) return
        refresh()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [pageInfo.url, refresh, settings?.loggedIn])

  return (
    <div className="min-h-screen bg-slate-50 pb-14 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-indigo-600 text-white">
              ✂︎
            </div>
            <div className="text-sm font-semibold">Clipper</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-60"
              disabled={isRefreshing}
              onClick={refresh}
              type="button">
              {isRefreshing ? "刷新中…" : "刷新"}
            </button>
            <button
              className="rounded border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 active:bg-slate-100"
              onClick={() =>
                setActiveTab((t) =>
                  t === "settings" ? "annotations" : "settings"
                )
              }
              type="button">
              <svg
                aria-hidden
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.591 1.066c1.543-.978 3.313.792 2.335 2.335a1.724 1.724 0 0 0 1.066 2.591c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.591c.978 1.543-.792 3.313-2.335 2.335a1.724 1.724 0 0 0-2.591 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.591-1.066c-1.543.978-3.313-.792-2.335-2.335a1.724 1.724 0 0 0-1.066-2.591c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.591c-.978-1.543.792-3.313 2.335-2.335a1.724 1.724 0 0 0 2.591-1.066Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          </div>
        </div>

        <button
          className={`w-full border-t border-slate-200 px-3 py-2 text-left ${
            settings?.loggedIn === false
              ? "bg-rose-50 text-rose-900"
              : "bg-white text-slate-900"
          }`}
          onClick={() => setPageCollapsed((v) => !v)}
          type="button">
          <div className="flex items-center gap-2">
            {settings?.loggedIn === false ? (
              <div className="text-sm font-semibold">请登录</div>
            ) : (
              <>
                {pageInfo.faviconUrl ? (
                  <img
                    alt=""
                    className="h-4 w-4 rounded"
                    src={pageInfo.faviconUrl}
                  />
                ) : (
                  <div className="h-4 w-4 rounded bg-slate-200" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-slate-500">
                    {domain || "（未获取到域名）"}
                  </div>
                  {!pageCollapsed ? (
                    <div className="truncate text-sm font-semibold">
                      {pageInfo.title || "（未获取到标题）"}
                    </div>
                  ) : null}
                </div>
              </>
            )}
            <div className="text-slate-400">{pageCollapsed ? "▸" : "▾"}</div>
          </div>
          {settings?.loggedIn === false ? (
            <div className="mt-1 text-xs text-rose-700">
              登录已过期，Clipper 暂时停止工作
            </div>
          ) : null}
        </button>
      </div>

      <div className="p-3">
        {error ? (
          <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <div className="flex items-center justify-between gap-2">
              <span>{error}</span>
              <button
                className="rounded bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
                onClick={refresh}
                type="button">
                重试
              </button>
            </div>
          </div>
        ) : null}

        {success ? (
          <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{success}</span>
              <button
                className="shrink-0 rounded bg-white px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                onClick={() => setSuccess(null)}
                type="button">
                关闭
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "annotations" ? (
          <>
            {pending ? (
              <div className="mb-3 rounded border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium text-slate-500">
                  待创建任务的批注
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-900">
                  {pending.selectedText}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{shortUrl(pending.url)}</span>
                  <button
                    className="shrink-0 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                    onClick={() => {
                      setPending(null)
                      setTaskDialogOpen(false)
                    }}
                    type="button">
                    清除
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mb-2 text-xs font-medium text-slate-500">
              我的批注
            </div>
            {isRefreshing && items.length === 0 ? (
              <div className="rounded border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                加载中…
              </div>
            ) : (
              <AnnotationList
                items={items}
                onCreateTask={(annotationId) => {
                  const it = items.find((x) => x.id === annotationId)
                  if (!it) return
                  setPending({
                    annotationId,
                    url: pageInfo.url,
                    selectedText: it.selectedText,
                    title: it.title
                  })
                  if (settings?.loggedIn === false) {
                    setActiveTab("settings")
                    return
                  }
                  setTaskDialogOpen(true)
                }}
              />
            )}
          </>
        ) : (
          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-900">
              设置（MVP）
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  QTable API 端点
                </div>
                <input
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={async (e) => {
                    const next = await patchSettings({
                      apiEndpoint: e.target.value
                    })
                    setSettings(next)
                  }}
                  placeholder="https://api.notescriptx.com (占位)"
                  value={settings?.apiEndpoint ?? ""}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">批注方式</div>
                <select
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={async (e) => {
                    const next = await patchSettings({ annotationMode: e.target.value as NsXSettings["annotationMode"] })
                    setSettings(next)
                  }}
                  value={settings?.annotationMode ?? "highlight"}>
                  <option value="highlight">文字高亮批注</option>
                  <option value="line">手绘划线批注</option>
                  <option value="box">框选批注</option>
                </select>
                <div className="mt-1 text-xs text-slate-400">手绘划线：在网页上按住鼠标拖动；框选：拖拽出矩形区域。</div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">
                  默认表格
                </div>
                <select
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={async (e) => {
                    const next = await patchSettings({
                      defaultTableId: e.target.value
                    })
                    setSettings(next)
                  }}
                  value={settings?.defaultTableId ?? qtables[0]?.id ?? ""}>
                  {qtables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {(t.emoji ? `${t.emoji} ` : "") + t.name} ({t.row_count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    登录状态
                  </div>
                  {settings?.userName ? (
                    <div className="mt-1 flex items-center gap-2">
                      {settings.userAvatar ? (
                        <img
                          src={settings.userAvatar}
                          alt=""
                          className="h-6 w-6 rounded-full"
                        />
                      ) : null}
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {settings.userName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {settings.userEmail}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">未登录</div>
                  )}
                </div>
                {settings?.loggedIn ? (
                  <button
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={async () => {
                      if (!confirm("确定要退出登录吗？")) return
                      try {
                        await chrome.runtime.sendMessage({ type: "OAUTH_LOGOUT" })
                        await patchSettings({
                          loggedIn: false,
                          userEmail: undefined,
                          userName: undefined,
                          userAvatar: undefined
                        })
                        setSettings(await getSettings())
                        setSuccess("已退出登录")
                      } catch (err) {
                        setError("退出失败")
                      }
                    }}
                    type="button">
                    退出登录
                  </button>
                ) : (
                  <button
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    disabled={isLoggingIn}
                    onClick={async () => {
                      try {
                        setIsLoggingIn(true)
                        setError(null)
                        const email = window.prompt("QTable 邮箱")?.trim()
                        const password = window.prompt("QTable 密码")
                        if (!email || !password) throw new Error("已取消登录")
                        await chrome.runtime.sendMessage({ type: "OAUTH_START_LOGIN", email, password })
                        // The background script will handle the OAuth flow
                        // and send AUTH_STATE_CHANGED message when done
                      } catch (err) {
                        setError("启动登录失败")
                        setIsLoggingIn(false)
                      }
                    }}
                    type="button">
                    {isLoggingIn ? "登录中..." : "去登录"}
                  </button>
                )}
              </div>
            </div>
            {settings?.loggedIn === false ? (
              <div className="mt-3 flex items-center justify-end">
                <button
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60"
                  disabled={isLoggingIn}
                  onClick={async () => {
                    try {
                      setIsLoggingIn(true)
                      setError(null)
                      const email = window.prompt("QTable 邮箱")?.trim()
                      const password = window.prompt("QTable 密码")
                      if (!email || !password) throw new Error("已取消登录")
                      await chrome.runtime.sendMessage({ type: "OAUTH_START_LOGIN", email, password })
                    } catch (err) {
                      setError("启动登录失败")
                      setIsLoggingIn(false)
                    }
                  }}
                  type="button">
                  {isLoggingIn ? "登录中..." : "去登录"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pending && settings?.loggedIn !== false ? (
        <TaskForm
          defaultTableId={settings?.defaultTableId}
          onOpenChange={(open) => {
            setTaskDialogOpen(open)
            if (!open) setPending(null)
          }}
          onSubmit={async (form) => {
            const ann = await getAnnotationById(pending.annotationId)
            const note = ann?.note ?? ""
            const res = await createTaskFromAnnotation({
              annotationId: pending.annotationId,
              task: {
                title: form.title,
                assignee_email: form.assignee,
                due_date: form.dueDate,
                target_table_id: form.tableId,
                include_context_url: form.includeContextUrl,
                note: ann?.note ?? "",
                selected_text: ann?.selectedText ?? pending.selectedText,
                page_url: ann?.url ?? pending.url,
                page_title: ann?.pageTitle ?? "",
                mode: ann?.mode ?? pending.mode
              }
            })
            await updateAnnotationById(pending.annotationId, (a) => ({
              ...a,
              note: a.note ?? note,
              task: {
                status: "created",
                taskId: res.task_id,
                qtableUrl: res.qtable_url
              }
            }))
            const tableName =
              qtables.find((t) => t.id === form.tableId)?.name ?? "目标表格"
            setSuccess(`任务已派发至 ${tableName}`)
            await refresh()
          }}
          open={taskDialogOpen}
          qt={qtables}
          users={qtableUsers}
          selectedText={pendingText}
          defaultTitle={pending.title}
        />
      ) : null}

      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            当前页批注 {items.length}
          </div>
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60"
            onClick={() => {
              if (settings?.loggedIn === false) {
                setActiveTab("settings")
                return
              }
              const id =
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? (crypto as any).randomUUID()
                  : `blank_${Date.now()}`
              setPending({
                annotationId: id,
                url: pageInfo.url,
                selectedText: ""
              })
              setTaskDialogOpen(true)
            }}
            type="button">
            {settings?.loggedIn === false ? "去登录" : "新建空白任务"}
          </button>
        </div>
      </div>
    </div>
  )
}
