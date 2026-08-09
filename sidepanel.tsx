import { useCallback, useEffect, useMemo, useRef, useState } from "react";






import "~style.css";



import { AnnotationList, type AnnotationPreview } from "~components/AnnotationList";
import { TaskForm } from "~components/TaskForm";
import { createTaskFromAnnotation, getQtables, getQtableUsers, getTaskStatus, hydrateAnnotationsFromQNote, updateTaskStatus, type QTable, type QTableUser } from "~utils/api";
import { CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION, STORAGE_UPDATED, type BackgroundBroadcastMessage, type OpenSidePanelPayload } from "~utils/messaging";
import { getSettings, patchSettings, type NsXSettings } from "~utils/settings";
import { getAllAnnotations, getAnnotationById, normalizePageUrl, NSX_ANNOTATIONS_KEY, updateAnnotationById } from "~utils/storage";
import { getAuthState } from "~utils/auth";





type PageInfo = {
  title: string
  url: string
  faviconUrl?: string
}

type PageChoice = {
  url: string
  title: string
}

const getCurrentPageInfo = async (): Promise<PageInfo> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return {
    title: tab?.title ?? "",
    url: normalizePageUrl(tab?.url ?? ""),
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

const tableIdFromQTableUrl = (url?: string) => {
  if (!url) return undefined
  const match = url.match(/\/table\/([^/?#]+)/)
  return match?.[1]
}

export default function SidePanel() {
  const [pageInfo, setPageInfo] = useState<PageInfo>({ title: "", url: "" })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pending, setPending] = useState<OpenSidePanelPayload | null>(null)
  const [items, setItems] = useState<AnnotationPreview[]>([])
  const [qtables, setQtables] = useState<QTable[]>([])
  const [qtableUsers, setQtableUsers] = useState<QTableUser[]>([])
  const [pageChoices, setPageChoices] = useState<PageChoice[]>([])
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"annotations" | "settings">(
    "annotations"
  )
  const [settings, setSettings] = useState<NsXSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pageCollapsed, setPageCollapsed] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const successTimerRef = useRef<number | null>(null)
  const isLoggedIn = settings?.loggedIn === true

  const pendingText = pending?.selectedText ?? ""
  const domain = useMemo(
    () => (selectedPageUrl || pageInfo.url ? shortUrl(selectedPageUrl || pageInfo.url) : ""),
    [pageInfo.url, selectedPageUrl]
  )
  const displayUrl = selectedPageUrl || pageInfo.url
  const selectedPage = pageChoices.find((page) => page.url === displayUrl)
  const displayTitle = selectedPageUrl ? (selectedPage?.title || shortUrl(displayUrl)) : pageInfo.title

  const refresh = useCallback(async (forceCurrent = false) => {
    setIsRefreshing(true)
    setError(null)
    try {
      // Check auth state first
      const authState = await getAuthState()
      
      const info = await getCurrentPageInfo()
      setPageInfo(info)
      if (forceCurrent) setSelectedPageUrl(null)

      const st = await getSettings()
      if (!authState.isAuthenticated) {
        setSettings({ ...st, loggedIn: false, defaultTableId: "" })
        setQtables([])
        setItems([])
        setActiveTab("settings")
        return
      }

      const qts = await getQtables()
      setQtables(qts)
      setQtableUsers(await getQtableUsers())

      // Pull the authoritative server copy before rendering. QNote outages do
      // not block access to the extension's offline cache.
      try {
        if (info.url) await hydrateAnnotationsFromQNote(info.url)
        if (selectedPageUrl && selectedPageUrl !== info.url) {
          await hydrateAnnotationsFromQNote(selectedPageUrl)
        }
      } catch {
        // Offline-first: pending local captures remain available and will sync
        // automatically when the service is reachable again.
      }

      const validDefaultTableId = qts.some((table) => table.id === st.defaultTableId) ? st.defaultTableId : ""
      if (validDefaultTableId !== st.defaultTableId) await patchSettings({ defaultTableId: validDefaultTableId })
      setSettings({ ...st, loggedIn: true, defaultTableId: validDefaultTableId, userEmail: authState.user?.email ?? st.userEmail, userName: authState.user?.name ?? st.userName, userAvatar: authState.user?.avatar_url ?? st.userAvatar })

      const allAnnotations = await getAllAnnotations()
      const choices = new Map<string, PageChoice>()
      for (const annotation of allAnnotations) {
        if (!annotation.url || choices.has(annotation.url)) continue
        choices.set(annotation.url, { url: annotation.url, title: annotation.pageTitle || shortUrl(annotation.url) })
      }
      if (info.url && !choices.has(info.url)) choices.set(info.url, { url: info.url, title: info.title || shortUrl(info.url) })
      setPageChoices(Array.from(choices.values()))
      const targetUrl = forceCurrent ? info.url : (selectedPageUrl || info.url)
      const normalizedTarget = normalizePageUrl(targetUrl)
      const visibleAnnotations = allAnnotations.filter(
        (annotation) => normalizePageUrl(annotation.url) === normalizedTarget
      )
      const nextItems: AnnotationPreview[] = visibleAnnotations.map((a) => ({
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
                qtableUrl: a.task.qtableUrl,
                tableId: a.task.tableId || tableIdFromQTableUrl(a.task.qtableUrl),
                statusFieldId: a.task.statusFieldId,
                statusFieldName: a.task.statusFieldName,
                statusFieldType: a.task.statusFieldType,
                statusValue: a.task.statusValue,
                statusOptions: a.task.statusOptions
              }
            : { kind: "not_created" }
      }))
      const hydratedItems = await Promise.all(nextItems.map(async (item) => {
        if (item.task.kind !== "created" || !item.task.tableId) return item
        try {
          const remote = await getTaskStatus(item.task.taskId, item.task.tableId)
          if (remote.status.value !== item.task.statusValue || remote.status.field_id !== item.task.statusFieldId) {
            await updateAnnotationById(item.id, (annotation) => annotation.task?.status === "created" ? {
              ...annotation,
              task: {
                ...annotation.task,
                statusFieldId: remote.status.field_id,
                statusFieldName: remote.status.field_name,
                statusFieldType: remote.status.field_type,
                statusValue: remote.status.value,
                statusOptions: remote.status.options
              }
            } : annotation)
          }
          return {
            ...item,
            task: {
              ...item.task,
              statusFieldId: remote.status.field_id,
              statusFieldName: remote.status.field_name,
              statusFieldType: remote.status.field_type,
              statusValue: remote.status.value,
              statusOptions: remote.status.options
            }
          }
        } catch {
          return item
        }
      }))
      setItems(hydratedItems)
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
  }, [selectedPageUrl])

  const handleLogin = async () => {
    const email = loginEmail.trim()
    if (!email || !loginPassword) {
      setError("请输入 QTable 邮箱和密码")
      return
    }
    setIsLoggingIn(true)
    setError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: "OAUTH_START_LOGIN", email, password: loginPassword })
      if (!response?.ok) throw new Error(response?.error || "登录失败")
      setLoginPassword("")
      setSuccess("登录成功，正在加载你的数据表…")
      await refresh()
      setActiveTab("annotations")
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setIsLoggingIn(false)
    }
  }

  const handleStatusChange = async (annotationId: string, value: string) => {
    const item = items.find((candidate) => candidate.id === annotationId)
    if (!item || item.task.kind !== "created" || !item.task.tableId) {
      setError("这条任务缺少 QTable 表格信息，请重新创建任务")
      return
    }
    try {
      const result = await updateTaskStatus({
        taskId: item.task.taskId,
        targetTableId: item.task.tableId,
        statusFieldId: item.task.statusFieldId,
        value
      })
      await updateAnnotationById(annotationId, (annotation) => ({
        ...annotation,
        task: annotation.task?.status === "created" ? {
          ...annotation.task,
          tableId: result.target_table_id,
          statusFieldId: result.status.field_id,
          statusFieldName: result.status.field_name,
          statusFieldType: result.status.field_type,
          statusValue: result.status.value,
          statusOptions: result.status.options
        } : annotation.task
      }))
      setItems((current) => current.map((candidate) => candidate.id === annotationId ? {
        ...candidate,
        task: candidate.task.kind === "created" ? {
          ...candidate.task,
          statusFieldId: result.status.field_id,
          statusFieldName: result.status.field_name,
          statusFieldType: result.status.field_type,
          statusValue: result.status.value,
          statusOptions: result.status.options
        } : candidate.task
      } : candidate))
      setSuccess(`任务状态已更新为 ${result.status.options.find((option) => option.id === result.status.value)?.label || result.status.value}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新任务状态失败")
    }
  }

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onActivated = () => {
      setSelectedPageUrl(null)
      void refresh(true)
    }
    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status !== "complete") return
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id === tabId) {
          setSelectedPageUrl(null)
          void refresh(true)
        }
      })
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
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
        if (isLoggedIn) setTaskDialogOpen(true)
        else setActiveTab("settings")
        return
      }

      if (message?.type === STORAGE_UPDATED) {
        const p = message.payload
        if (p?.key !== NSX_ANNOTATIONS_KEY) return
        if (p.urls && displayUrl && !p.urls.includes(displayUrl)) return
        refresh()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [displayUrl, pageInfo.url, refresh, isLoggedIn])

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
              onClick={() => void refresh()}
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

        {isLoggedIn && pageChoices.length > 0 ? (
          <div className="border-t border-slate-100 px-3 pb-2">
            <label className="sr-only" htmlFor="nsx-page-selector">切换批注网页</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400 focus:bg-white"
              id="nsx-page-selector"
              onChange={(e) => setSelectedPageUrl(e.target.value === "__current__" ? null : e.target.value)}
              value={selectedPageUrl || "__current__"}>
              <option value="__current__">当前网页：{pageInfo.title || shortUrl(pageInfo.url) || "未命名页面"}</option>
              {pageChoices.filter((page) => page.url !== pageInfo.url).map((page) => (
                <option key={page.url} value={page.url}>{page.title} · {shortUrl(page.url)}</option>
              ))}
            </select>
          </div>
        ) : null}

        <button
          className={`w-full border-t border-slate-200 px-3 py-2 text-left ${
            !isLoggedIn
              ? "bg-amber-50 text-amber-950"
              : "bg-white text-slate-900"
          }`}
          onClick={() => setPageCollapsed((v) => !v)}
          type="button">
          <div className="flex items-center gap-2">
            {!isLoggedIn ? (
              <div className="text-sm font-semibold">登录 QTable 后开始批注</div>
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
                      {displayTitle || "（未获取到标题）"}
                    </div>
                  ) : null}
                </div>
              </>
            )}
            <div className="text-slate-400">{pageCollapsed ? "▸" : "▾"}</div>
          </div>
          {!isLoggedIn ? (
            <div className="mt-1 text-xs text-amber-800">
              未登录：暂不加载数据表，也不能创建任务
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
                onClick={() => void refresh()}
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
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
              <span>{selectedPageUrl ? "所选网页批注" : "当前网页批注"}</span>
              <span>{shortUrl(displayUrl)}</span>
            </div>
            {isRefreshing && items.length === 0 ? (
              <div className="rounded border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                加载中…
              </div>
            ) : (
              <AnnotationList
                items={items}
                onStatusChange={handleStatusChange}
                onCreateTask={(annotationId) => {
                  const it = items.find((x) => x.id === annotationId)
                  if (!it) return
                  setPending({
                    annotationId,
                    url: displayUrl,
                    selectedText: it.selectedText,
                    title: it.title,
                    mode: it.mode
                  })
                  if (!isLoggedIn) {
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
              设置与账户
            </div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  API 端点
                </div>
                <input
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400"
                  onChange={async (e) => {
                    const next = await patchSettings({
                      apiEndpoint: e.target.value
                    })
                    setSettings(next)
                  }}
                  placeholder="http://localhost:8000"
                  value={settings?.apiEndpoint ?? ""}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">
                  默认目标数据表
                </div>
                <select
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  disabled={!isLoggedIn || qtables.length === 0}
                  onChange={async (e) => {
                    const next = await patchSettings({
                      defaultTableId: e.target.value
                    })
                    setSettings(next)
                  }}
                  value={settings?.defaultTableId ?? ""}>
                  <option value="">请选择默认数据表</option>
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
                {isLoggedIn ? (
                  <button
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={async () => {
                      if (!confirm("确定要退出登录吗？")) return
                      try {
                        await chrome.runtime.sendMessage({ type: "OAUTH_LOGOUT" })
                        await patchSettings({
                          loggedIn: false,
                          defaultTableId: "",
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
                ) : <div className="text-xs text-slate-500">请在下方输入账号登录</div>}
              </div>
            </div>
            {!isLoggedIn ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 text-sm font-semibold text-slate-900">登录 QTable</div>
                <div className="space-y-2">
                  <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" autoComplete="username" onChange={(e) => setLoginEmail(e.target.value)} placeholder="QTable 邮箱" type="email" value={loginEmail} />
                  <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" autoComplete="current-password" onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleLogin() }} placeholder="密码" type="password" value={loginPassword} />
                  <button className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isLoggingIn} onClick={() => void handleLogin()} type="button">
                    {isLoggingIn ? "登录中…" : "登录"}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500">账号密码只用于登录本地 QTable 服务，不会打开浏览器弹窗。</div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pending && isLoggedIn ? (
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
                qtableUrl: res.qtable_url,
                tableId: res.target_table_id || form.tableId,
                statusFieldId: res.status?.field_id,
                statusFieldName: res.status?.field_name,
                statusFieldType: res.status?.field_type,
                statusValue: res.status?.value,
                statusOptions: res.status?.options
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
            {selectedPageUrl ? "所选网页" : "当前网页"}批注 {items.length}
          </div>
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60"
            onClick={() => {
              if (!isLoggedIn) {
                setActiveTab("settings")
                return
              }
              const id =
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? (crypto as any).randomUUID()
                  : `blank_${Date.now()}`
              setPending({
                annotationId: id,
                url: displayUrl,
                selectedText: "",
                title: "",
                mode: "highlight"
              })
              setTaskDialogOpen(true)
            }}
            type="button">
            {isLoggedIn ? "新建空白任务" : "先登录 QTable"}
          </button>
        </div>
      </div>
    </div>
  )
}
