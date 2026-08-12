/** Authentication for the QNote-owned browser-clipper boundary. */

export const QNOTE_API_BASE_URL =
  process.env.PLASMO_PUBLIC_QNOTE_API_URL || "http://localhost:9001"

// QTable is only opened after QNote has created a linked action.
export const QTABLE_WEB_BASE_URL =
  process.env.PLASMO_PUBLIC_QTABLE_WEB_URL || "http://localhost:9100"

const STORAGE_KEYS = {
  ACCESS_TOKEN: "qnote_access_token",
  EXPIRES_AT: "qnote_expires_at",
  USER_INFO: "qnote_user_info"
} as const

export type UserInfo = {
  id: string
  name: string
  email: string
  avatar_url?: string
}

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  user: UserInfo | null
  error: string | null
}

const decodeBase64Url = (input: string): string => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  return atob(padded)
}

const parseJwtExpMs = (token: string): number | null => {
  try {
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1])) as { exp?: unknown }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

const storeTokens = async (accessToken: string): Promise<void> => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACCESS_TOKEN]: accessToken,
    [STORAGE_KEYS.EXPIRES_AT]: parseJwtExpMs(accessToken) ?? Date.now() + 3_600_000
  })
}

const fetchUserInfo = async (accessToken: string): Promise<UserInfo | null> => {
  try {
    const response = await fetch(`${QNOTE_API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!response.ok) return null
    const payload = await response.json() as {
      id: number | string
      name: string
      email: string
    }
    const user: UserInfo = {
      id: String(payload.id),
      name: payload.name,
      email: payload.email
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_INFO]: user })
    return user
  } catch {
    return null
  }
}

export async function loginWithPassword(email: string, password: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${QNOTE_API_BASE_URL}/api/clipper/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    })
  } catch {
    throw new Error(
      `无法连接 QNoteServer（${QNOTE_API_BASE_URL}）。请先启动 QNoteServer，并确认插件配置的 PLASMO_PUBLIC_QNOTE_API_URL。`
    )
  }
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string
    detail?: string
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.detail || "账号或密码错误")
  }
  await storeTokens(payload.access_token)
  const user = await fetchUserInfo(payload.access_token)
  if (!user) {
    await clearAuth()
    throw new Error(
      "QNoteServer 无法验证登录会话。请确认它与 QTable 使用相同的 SECRET_KEY。"
    )
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.EXPIRES_AT
  ])
  const token = storage[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined
  const expiresAt = storage[STORAGE_KEYS.EXPIRES_AT] as number | undefined
  if (!token || !expiresAt || Date.now() >= expiresAt) {
    await clearAuth()
    return null
  }
  return token
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.EXPIRES_AT,
    STORAGE_KEYS.USER_INFO
  ])
}

export async function getAuthState(): Promise<AuthState> {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.EXPIRES_AT,
    STORAGE_KEYS.USER_INFO
  ])
  const token = storage[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined
  const expiresAt = storage[STORAGE_KEYS.EXPIRES_AT] as number | undefined
  const isAuthenticated = Boolean(token && expiresAt && Date.now() < expiresAt)
  return {
    isAuthenticated,
    isLoading: false,
    user: isAuthenticated
      ? (storage[STORAGE_KEYS.USER_INFO] as UserInfo | undefined) || null
      : null,
    error: null
  }
}

export async function logout(): Promise<void> {
  await clearAuth()
}
