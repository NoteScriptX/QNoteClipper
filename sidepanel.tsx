import { useCallback, useEffect, useMemo, useRef, useState } from "react";






import "~style.css";



import { AnnotationList, type AnnotationPreview } from "~components/AnnotationList";
import { Popconfirm } from "~components/Popconfirm";
import { TaskForm } from "~components/TaskForm";
import { createTaskFromAnnotation, deleteAnnotationFromQNote, getActionOptions, getTaskStatus, hydrateAnnotationsFromQNote, updateTaskStatus, type QTable, type QTableUser } from "~utils/api";
import { CONTENT_LOCATE_ANNOTATION, CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION, CONTENT_REMOVE_ANNOTATION_OVERLAY, STORAGE_UPDATED, type BackgroundBroadcastMessage, type OpenSidePanelPayload } from "~utils/messaging";
import { getSettings, patchSettings, type NsXSettings } from "~utils/settings";
import { deleteAnnotationLocallyById, getAllAnnotations, getAnnotationById, normalizePageUrl, NSX_ANNOTATIONS_KEY, updateAnnotationById, updateAnnotationLocallyById, upsertAnnotation } from "~utils/storage";
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
  const [isActionOptionsLoading, setIsActionOptionsLoading] = useState(false)
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
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const actionOptionsInFlightRef = useRef<Promise<void> | null>(null)
  const isLoggedIn = settings?.loggedIn === true

  const pendingText = pending?.selectedText ?? ""
  const domain = useMemo(
    () => (selectedPageUrl || pageInfo.url ? shortUrl(selectedPageUrl || pageInfo.url) : ""),
    [pageInfo.url, selectedPageUrl]
  )
  const displayUrl = selectedPageUrl || pageInfo.url
  const selectedPage = pageChoices.find((page) => page.url === displayUrl)
  const displayTitle = selectedPageUrl ? (selectedPage?.title || shortUrl(displayUrl)) : pageInfo.title

  const refresh = useCallback((forceCurrent = false): Promise<void> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current

    const job = (async () => {
      setIsRefreshing(true)
      setError(null)
      try {
      // Check auth state first
      const authState = await getAuthState()
      
      const info = await getCurrentPageInfo()
      setPageInfo(info)
      if (forceCurrent) setSelectedPageUrl(null)

      const st = await getSettings()

      // Local-first：无论是否登录都展示本地批注。登录状态只影响“同步”与
      // “创建行动”能力，绝不能在未登录时清空用户已经捕获的本地数据。
      if (authState.isAuthenticated) {
        setSettings((current) => {
          const next = {
            ...st,
            loggedIn: true,
            userEmail: authState.user?.email ?? st.userEmail,
            userName: authState.user?.name ?? st.userName,
            userAvatar: authState.user?.avatar_url ?? st.userAvatar
          }
          return current &&
            current.loggedIn === next.loggedIn &&
            current.userEmail === next.userEmail &&
            current.userName === next.userName &&
            current.userAvatar === next.userAvatar
            ? current
            : next
        })

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
      } else {
        setSettings({ ...st, loggedIn: false })
        setQtables([])
      }

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
        syncStatus: a.syncStatus,
        syncError: a.syncError,
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
            await updateAnnotationLocallyById(item.id, (annotation) => annotation.task?.status === "created" ? {
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
          setError("登录已过期，请重新登录 QNote")
          await patchSettings({ loggedIn: false })
          setSettings(await getSettings())
        } else {
          setError(err instanceof Error ? err.message : "加载失败，请重试")
        }
      } finally {
        setIsRefreshing(false)
      }
    })()
    refreshInFlightRef.current = job
    void job.finally(() => {
      if (refreshInFlightRef.current === job) refreshInFlightRef.current = null
    })
    return job
  }, [selectedPageUrl])

  const loadActionOptions = useCallback(async (): Promise<void> => {
    if (actionOptionsInFlightRef.current) return actionOptionsInFlightRef.current

    const job = (async () => {
      setIsActionOptionsLoading(true)
      try {
        const actionOptions = await getActionOptions()
        setQtables(actionOptions.tables)
        setQtableUsers(actionOptions.users)
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法加载可用目标表")
      } finally {
        setIsActionOptionsLoading(false)
      }
    })()
    actionOptionsInFlightRef.current = job
    void job.finally(() => {
      if (actionOptionsInFlightRef.current === job) actionOptionsInFlightRef.current = null
    })
    return job
  }, [])

  const openTaskDialog = async (annotationId: string) => {
    const item = items.find((candidate) => candidate.id === annotationId)
    if (!item) return
    setPending({
      annotationId,
      url: displayUrl,
      selectedText: item.selectedText,
      title: item.title,
      mode: item.mode
    })
    if (!isLoggedIn) {
      setActiveTab("settings")
      return
    }
    setTaskDialogOpen(true)
    await loadActionOptions()
  }

  const handleLogin = async () => {
    const email = loginEmail.trim()
    if (!email || !loginPassword) {
      setError("请输入 QNote 邮箱和密码")
      return
    }
    setIsLoggingIn(true)
    setError(null)
    try {
      const response = await chrome.runtime.sendMessage({ type: "OAUTH_START_LOGIN", email, password: loginPassword })
      if (!response?.ok) throw new Error(response?.error || "登录失败")
      setLoginPassword("")
      setSuccess("登录成功，正在加载你的行动空间…")
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
      setError("这条行动缺少目标表信息，请重新创建")
      return
    }
    try {
      const result = await updateTaskStatus({
        taskId: item.task.taskId,
        targetTableId: item.task.tableId,
        statusFieldId: item.task.statusFieldId,
        value
      })
      await updateAnnotationLocallyById(annotationId, (annotation) => ({
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
      setSuccess(`行动状态已更新为 ${result.status.options.find((option) => option.id === result.status.value)?.label || result.status.value}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新行动状态失败")
    }
  }

  const handleLocate = async (annotationId: string) => {
    const annotation = await getAnnotationById(annotationId)
    if (!annotation) {
      setError("批注不存在或已被删除")
      return
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setError("无法定位当前浏览器标签页")
      return
    }
    if (normalizePageUrl(tab.url || "") === normalizePageUrl(annotation.url)) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: CONTENT_LOCATE_ANNOTATION, annotationId })
      } catch {
        setError("当前页面尚未加载 QNote Clipper，请刷新网页后重试")
        return
      }
    } else {
      const target = new URL(annotation.url)
      target.searchParams.set("qnote_annotation", annotation.serverId || annotation.id)
      await chrome.tabs.update(tab.id, { url: target.toString() })
    }
    setSuccess("正在定位原文…")
  }

  const handleUpdateAnnotation = async (
    annotationId: string,
    input: { title: string; note: string }
  ) => {
    await updateAnnotationById(annotationId, (annotation) => ({
      ...annotation,
      title: input.title,
      note: input.note
    }))
    setItems((current) => current.map((item) => item.id === annotationId ? {
      ...item,
      title: input.title,
      note: input.note
    } : item))
    setSuccess("批注已更新，正在同步到 QNote")
  }

  const handleDeleteAnnotation = async (annotationId: string) => {
    const annotation = await getAnnotationById(annotationId)
    if (!annotation) {
      setError("批注不存在或已被删除")
      return
    }

    try {
      // Local state and the current page are the immediate source of truth for
      // the interaction. Do not keep a deleted annotation visible while a
      // network request is still in flight.
      await deleteAnnotationLocallyById(annotationId)
      setItems((current) => current.filter((item) => item.id !== annotationId))

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (
        tab?.id &&
        normalizePageUrl(tab.url || "") === normalizePageUrl(annotation.url)
      ) {
        await chrome.tabs.sendMessage(tab.id, {
          type: CONTENT_REMOVE_ANNOTATION_OVERLAY,
          annotationId
        }).catch(() => undefined)
      }

      await deleteAnnotationFromQNote(annotationId, annotation.serverId)
      setSuccess("批注已删除")
    } catch (err) {
      setError(
        err instanceof Error
          ? `批注已从当前页面移除，但同步删除失败：${err.message}`
          : "批注已从当前页面移除，但同步删除失败"
      )
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
          void loadActionOptions()
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
  }, [loadActionOptions, pending, refresh])

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
        if (isLoggedIn) {
          setTaskDialogOpen(true)
          void loadActionOptions()
        }
        else setActiveTab("settings")
        return
      }

      if (message?.type === STORAGE_UPDATED) {
        const p = message.payload
        if (p?.key !== NSX_ANNOTATIONS_KEY) return
        // QNote hydration also persists server metadata locally. It has no
        // changed page URL, so treating it as a new capture creates a
        // refresh -> storage update -> refresh loop.
        if (!p.urls?.length) return
        if (displayUrl && !p.urls.includes(displayUrl)) return
        void refresh()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [displayUrl, isLoggedIn, loadActionOptions, refresh])

  return (
    <div className="min-h-screen bg-slate-50 pb-14 text-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-indigo-600 text-white">
              ✂︎
            </div>
            <div className="text-sm font-semibold">QNote Clipper</div>
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
              <div className="text-sm font-semibold">登录 QNote 后开始捕获</div>
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
              未登录：暂不能同步批注或创建任务
            </div>
          ) : null}
        </button>
      </div>

      <div className="p-3">
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
                onCreateTask={(annotationId) => void openTaskDialog(annotationId)}
                onLocate={displayUrl ? handleLocate : undefined}
                onUpdate={handleUpdateAnnotation}
                onDelete={handleDeleteAnnotation}
              />
            )}
          </>
        ) : (
          <div className="rounded border border-slate-200 bg-white p-3">
            <div className="text-sm font-semibold text-slate-900">
              设置与账户
            </div>
            <div className="mt-3 space-y-3">
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
                  <Popconfirm
                    cancelText="不退了"
                    description="退出后不会立即清除本地缓存，但需要重新登录才能继续同步。"
                    okText="退出"
                    okType="danger"
                    title="确定要退出登录吗？"
                    onCancel={() => undefined}
                    onConfirm={async () => {
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
                    placement="bottom">
                    <button
                      className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      type="button">
                      退出登录
                    </button>
                  </Popconfirm>
                ) : <div className="text-xs text-slate-500">请在下方输入账号登录</div>}
              </div>
            </div>
            {!isLoggedIn ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="mb-2 text-sm font-semibold text-slate-900">登录 QNote</div>
                <div className="space-y-2">
                  <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" autoComplete="username" onChange={(e) => setLoginEmail(e.target.value)} placeholder="QNote 邮箱" type="email" value={loginEmail} />
                  <input className="w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" autoComplete="current-password" onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleLogin() }} placeholder="密码" type="password" value={loginPassword} />
                  <button className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isLoggingIn} onClick={() => void handleLogin()} type="button">
                    {isLoggingIn ? "登录中…" : "登录"}
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-500">账号密码仅提交给 QNote 会话服务；插件不会直接连接 QTable。</div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {pending && isLoggedIn ? (
        <TaskForm
          onOpenChange={(open) => {
            setTaskDialogOpen(open)
            if (!open) setPending(null)
          }}
          onSubmit={async (form) => {
            let ann = await getAnnotationById(pending.annotationId)
            if (!ann) {
              await upsertAnnotation({
                id: pending.annotationId,
                url: pending.url,
                pageTitle: displayTitle,
                createdAt: Date.now(),
                selectedText: pending.selectedText,
                title: form.title,
                note: "",
                mode: pending.mode || "highlight",
                anchor: { selectedText: pending.selectedText, xpath: "", prefix: "", suffix: "", context: "" },
                locateStatus: "maybe_lost"
              })
              ann = await getAnnotationById(pending.annotationId)
            }
            await createTaskFromAnnotation({
              annotationId: pending.annotationId,
              task: {
                title: form.title,
                assignee_email: form.assignee,
                due_date: form.dueDate,
                target_table_id: form.tableId,
                note: ann?.note ?? ""
              }
            })
            const tableName =
              qtables.find((t) => t.id === form.tableId)?.name ?? "目标表格"
            setSuccess(`行动已创建于 ${tableName}`)
            await refresh()
          }}
          open={taskDialogOpen}
          qt={qtables}
          users={qtableUsers}
          loading={isActionOptionsLoading}
          selectedText={pendingText}
          defaultTitle={pending.title}
        />
      ) : null}

      {success || error ? (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-3">
          {success ? (
            <div
              className="nsx-message pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/95 px-3 py-2 text-sm text-emerald-800 shadow-lg ring-1 ring-emerald-100/60 backdrop-blur"
              role="status">
              <svg
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="m5 12 4 4 10-10"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="min-w-0 flex-1 break-words">{success}</span>
              <button
                aria-label="关闭"
                className="shrink-0 rounded bg-white/70 px-2 py-1 text-xs hover:bg-white"
                onClick={() => setSuccess(null)}
                type="button">
                关闭
              </button>
            </div>
          ) : null}
          {error ? (
            <div
              className="nsx-message pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/95 px-3 py-2 text-sm text-rose-700 shadow-lg ring-1 ring-rose-100/60 backdrop-blur"
              role="alert">
              <svg
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24">
                <path
                  d="M12 8v5m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button
                className="shrink-0 rounded bg-white/70 px-2 py-1 text-xs text-rose-700 hover:bg-white"
                onClick={() => void refresh()}
                type="button">
                重试
              </button>
              <button
                aria-label="关闭"
                className="shrink-0 rounded bg-white/70 px-2 py-1 text-xs hover:bg-white"
                onClick={() => setError(null)}
                type="button">
                关闭
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {selectedPageUrl ? "所选网页" : "当前网页"}批注 {items.length}
          </div>
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60"
            onClick={async () => {
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
              void loadActionOptions()
            }}
            type="button">
            {isLoggedIn ? "新建空白任务" : "先登录 QNote"}
          </button>
        </div>
      </div>
    </div>
  )
}
