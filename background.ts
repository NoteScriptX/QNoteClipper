import {
  broadcastFromExtension,
  CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION,
  CLIPPER_CREATE_TASK,
  CLIPPER_GET_TASK_OPTIONS,
  CONTENT_ACTIVATE_DRAW_MODE,
  CONTENT_OPEN_SELECTION_CARD,
  STORAGE_UPDATED,
  type ClipperCreateTaskMessage,
  type ContentToBackgroundMessage
} from "~utils/messaging"
import { NSX_ANNOTATIONS_KEY, type NsXAnnotation } from "~utils/storage"
import { getAuthState, startLoginFlow, loginWithPassword, logout as authLogout, getValidAccessToken } from "~utils/auth"
import { patchSettings } from "~utils/settings"
import { createTaskFromAnnotation, getQtableUsers, getQtables } from "~utils/api"

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})

const diffAnnotationUrls = (
  oldValue: unknown,
  newValue: unknown
): { urls: string[]; ids: string[] } => {
  if (!Array.isArray(oldValue) || !Array.isArray(newValue)) {
    return { urls: [], ids: [] }
  }

  const oldMap = new Map<string, NsXAnnotation>()
  for (const a of oldValue as NsXAnnotation[]) oldMap.set(a.id, a)

  const urls = new Set<string>()
  const ids = new Set<string>()

  for (const a of newValue as NsXAnnotation[]) {
    const prev = oldMap.get(a.id)
    if (!prev) {
      urls.add(a.url)
      ids.add(a.id)
      continue
    }
    const prevTaskId = prev.task?.taskId ?? ""
    const nextTaskId = a.task?.taskId ?? ""
    const prevNote = prev.note ?? ""
    const nextNote = a.note ?? ""
    if (prevTaskId !== nextTaskId || prevNote !== nextNote) {
      urls.add(a.url)
      ids.add(a.id)
    }
  }

  return { urls: Array.from(urls), ids: Array.from(ids) }
}

// OAuth message types
const OAUTH_START_LOGIN = "OAUTH_START_LOGIN" as const
const OAUTH_LOGOUT = "OAUTH_LOGOUT" as const
const OAUTH_GET_STATE = "OAUTH_GET_STATE" as const

type OAuthMessage =
  | { type: typeof OAUTH_START_LOGIN; email?: string; password?: string }
  | { type: typeof OAUTH_LOGOUT }
  | { type: typeof OAUTH_GET_STATE }

const createContextMenus = () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "nsx-root", title: "NoteScript 批注", contexts: ["page", "selection"] })
    chrome.contextMenus.create({ id: "nsx-text", parentId: "nsx-root", title: "文字批注", contexts: ["selection"] })
    chrome.contextMenus.create({ id: "nsx-line", parentId: "nsx-root", title: "手绘划线（一次）", contexts: ["page", "selection"] })
    chrome.contextMenus.create({ id: "nsx-box", parentId: "nsx-root", title: "框选批注（一次）", contexts: ["page", "selection"] })
  })
}

chrome.runtime.onInstalled.addListener(createContextMenus)
chrome.runtime.onStartup.addListener(createContextMenus)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  const message = info.menuItemId === "nsx-text"
    ? { type: CONTENT_OPEN_SELECTION_CARD }
    : info.menuItemId === "nsx-line"
      ? { type: CONTENT_ACTIVATE_DRAW_MODE, mode: "line" as const }
      : info.menuItemId === "nsx-box"
        ? { type: CONTENT_ACTIVATE_DRAW_MODE, mode: "box" as const }
        : null
  if (message) chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
})

chrome.runtime.onMessage.addListener(
  (message: ContentToBackgroundMessage | OAuthMessage | ClipperCreateTaskMessage | { type: typeof CLIPPER_GET_TASK_OPTIONS }, sender, sendResponse) => {
    if (!message || typeof message !== "object") return

    if (message.type === CLIPPER_GET_TASK_OPTIONS) {
      ;(async () => {
        try {
          sendResponse({ ok: true, tables: await getQtables(), users: await getQtableUsers() })
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "加载 QTable 数据失败" })
        }
      })()
      return true
    }

    if (message.type === CLIPPER_CREATE_TASK) {
      ;(async () => {
        try {
          const p = message.payload
          const task = await createTaskFromAnnotation({
            annotationId: p.annotationId,
            task: { title: p.title, note: p.note, selected_text: p.selectedText, page_url: p.pageUrl, page_title: p.pageTitle, mode: p.mode, target_table_id: p.tableId, assignee_email: p.assigneeEmail, due_date: p.dueDate, include_context_url: p.includeContextUrl }
          })
          sendResponse({ ok: true, task })
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "创建任务失败" })
        }
      })()
      return true
    }

    // Handle OAuth messages
    if (message.type === OAUTH_START_LOGIN) {
      ;(async () => {
        try {
          if (message.email && message.password) await loginWithPassword(message.email, message.password)
          else await startLoginFlow()
          // After successful login, update settings with user info
          const authState = await getAuthState()
          if (authState.isAuthenticated && authState.user) {
            await patchSettings({
              loggedIn: true,
              userEmail: authState.user.email,
              userName: authState.user.name,
              userAvatar: authState.user.avatar_url
            })
          }
          // Notify sidepanel to refresh
          chrome.runtime.sendMessage({ type: "AUTH_STATE_CHANGED" })
        } catch (error) {
          console.error("OAuth login failed:", error)
          chrome.runtime.sendMessage({
            type: "AUTH_ERROR",
            error: error instanceof Error ? error.message : "Login failed"
          })
        }
      })()
      return
    }

    if (message.type === OAUTH_LOGOUT) {
      ;(async () => {
        try {
          await authLogout()
          await patchSettings({
            loggedIn: false,
            userEmail: undefined,
            userName: undefined,
            userAvatar: undefined
          })
          chrome.runtime.sendMessage({ type: "AUTH_STATE_CHANGED" })
        } catch (error) {
          console.error("Logout failed:", error)
        }
      })()
      return
    }

    if (message.type === OAUTH_GET_STATE) {
      ;(async () => {
        try {
          const state = await getAuthState()
          sender.tab &&
            chrome.tabs.sendMessage(sender.tab.id!, {
              type: "AUTH_STATE_RESPONSE",
              state
            })
        } catch (error) {
          console.error("Failed to get auth state:", error)
        }
      })()
      return
    }

    // Handle existing content messages
    if ((message as ContentToBackgroundMessage).type !== CONTENT_OPEN_SIDEPANEL_WITH_ANNOTATION) return

    const typedMessage = message as ContentToBackgroundMessage
    const tabId = sender.tab?.id
    if (typeof tabId !== "number") return
    ;(async () => {
      try {
        await chrome.sidePanel.open({ tabId })
      } catch {
        // ignore
      }

      try {
        await chrome.runtime.sendMessage(typedMessage)
      } catch {
        // ignore
      }
    })()
  }
)

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return
  const change = changes[NSX_ANNOTATIONS_KEY]
  if (!change) return

  const { urls, ids } = diffAnnotationUrls(change.oldValue, change.newValue)

  ;(async () => {
    try {
      await broadcastFromExtension({
        type: STORAGE_UPDATED,
        payload: {
          key: NSX_ANNOTATIONS_KEY,
          urls: urls.length ? urls : undefined,
          annotationIds: ids.length ? ids : undefined
        }
      })
    } catch {
      // ignore
    }
  })()
})

// Set up periodic token refresh check (every 30 minutes)
chrome.alarms.create("tokenRefreshCheck", { periodInMinutes: 30 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tokenRefreshCheck") {
    ;(async () => {
      try {
        // This will automatically refresh if needed
        await getValidAccessToken()
      } catch (error) {
        console.error("Token refresh check failed:", error)
      }
    })()
  }
})
