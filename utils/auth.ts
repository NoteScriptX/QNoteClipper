/**
 * OAuth 2.0 + PKCE Authentication Module for Chrome Extension
 * Implements secure authentication flow with QTable Web application
 */

// Configuration - Update these values for your QTable deployment
const OAUTH_CONFIG = {
  // QTable Web OAuth authorization endpoint
  AUTHORIZATION_ENDPOINT: "http://localhost:9000/oauth/authorize",
  // QTable Web token endpoint
  TOKEN_ENDPOINT: "http://localhost:9000/oauth/token",
  // User info endpoint (optional)
  USER_INFO_ENDPOINT: "http://localhost:9000/oauth/me",
  // OAuth client ID registered in QTable
  CLIENT_ID: "note-script-clipper",
  // Requested scopes
  SCOPE: "openid profile email",
  // Set to true to use mock authentication for testing
  USE_MOCK_AUTH: false
}

export const QTABLE_API_BASE_URL = "http://localhost:9000"

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: "oauth_access_token",
  REFRESH_TOKEN: "oauth_refresh_token",
  EXPIRES_AT: "oauth_expires_at",
  PKCE_VERIFIER: "oauth_pkce_verifier",
  USER_INFO: "oauth_user_info"
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

/**
 * Generate a cryptographically random base64url-encoded string
 */
function base64URLEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * Compute SHA-256 hash of input string
 */
async function sha256(input: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  return await crypto.subtle.digest("SHA-256", data)
}

/**
 * Generate PKCE code verifier and challenge pair
 */
export async function generatePKCEPair(): Promise<{
  verifier: string
  challenge: string
}> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64URLEncode(randomBytes.buffer)
  const challengeBuffer = await sha256(verifier)
  const challenge = base64URLEncode(challengeBuffer)
  return { verifier, challenge }
}

/**
 * Build the OAuth authorization URL with PKCE parameters
 */
export async function buildAuthorizationUrl(): Promise<{ url: string; verifier: string }> {
  const { verifier, challenge } = await generatePKCEPair()
  
  // Store verifier temporarily in session storage (not persistent)
  chrome.storage.session.set({ [STORAGE_KEYS.PKCE_VERIFIER]: verifier })

  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`
  
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CONFIG.CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: OAUTH_CONFIG.SCOPE
  })

  const url = `${OAUTH_CONFIG.AUTHORIZATION_ENDPOINT}?${params.toString()}`
  return { url, verifier }
}

/**
 * Mock login for testing without OAuth backend
 */
async function mockLogin(): Promise<void> {
  console.log("Performing mock login...")
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Mock tokens
  const mockTokens = {
    access_token: "mock_access_token_" + Date.now(),
    refresh_token: "mock_refresh_token_" + Date.now(),
    expires_in: 3600 // 1 hour
  }
  
  // Store tokens
  await storeTokens(mockTokens)
  
  // Mock user info
  const mockUserInfo: UserInfo = {
    id: "mock_user_001",
    name: "测试用户",
    email: "test@example.com",
    avatar_url: "https://ui-avatars.com/api/?name=测试用户&background=random"
  }
  
  // Store user info
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_INFO]: mockUserInfo
  })
  
  console.log("Mock login successful", mockUserInfo)
}

/**
 * Launch the OAuth authorization flow using Chrome Identity API
 */
export async function startLoginFlow(): Promise<void> {
  // Use mock authentication for testing
  if (OAUTH_CONFIG.USE_MOCK_AUTH) {
    console.log("Using mock authentication")
    await mockLogin()
    return
  }

  const { url } = await buildAuthorizationUrl()

  try {
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url,
      interactive: true
    })

    if (!responseUrl) {
      throw new Error("No response from authorization server")
    }

    await handleCallback(responseUrl)
  } catch (error) {
    console.error("OAuth login failed:", error)
    throw error
  }
}

export async function loginWithPassword(email: string, password: string): Promise<void> {
  const response = await fetch(`${QTABLE_API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error(data.detail || "账号或密码错误")
  await storeTokens({ access_token: data.access_token, expires_in: 3600 })
  await fetchUserInfo(data.access_token)
}

/**
 * Handle the OAuth callback and exchange code for tokens
 */
async function handleCallback(callbackUrl: string): Promise<void> {
  const url = new URL(callbackUrl)
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")

  if (error) {
    const errorDescription = url.searchParams.get("error_description") || error
    throw new Error(`Authorization failed: ${errorDescription}`)
  }

  if (!code) {
    throw new Error("No authorization code received")
  }

  // Retrieve PKCE verifier from session storage
  const sessionData = await chrome.storage.session.get(STORAGE_KEYS.PKCE_VERIFIER)
  const verifier = sessionData[STORAGE_KEYS.PKCE_VERIFIER] as string | undefined

  if (!verifier) {
    throw new Error("PKCE verifier not found. Please try logging in again.")
  }

  // Clean up verifier from session storage
  await chrome.storage.session.remove(STORAGE_KEYS.PKCE_VERIFIER)

  // Exchange authorization code for tokens
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`
  
  const tokenResponse = await fetch(OAUTH_CONFIG.TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: OAUTH_CONFIG.CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  })

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json().catch(() => ({}))
    throw new Error(errorData.error_description || "Token exchange failed")
  }

  const tokens = await tokenResponse.json()

  if (!tokens.access_token) {
    throw new Error("No access token received")
  }

  // Store tokens securely
  await storeTokens(tokens)

  // Fetch user information
  await fetchUserInfo(tokens.access_token)
}

/**
 * Store OAuth tokens in chrome.storage.local
 */
async function storeTokens(tokens: {
  access_token: string
  refresh_token?: string
  expires_in?: number
}): Promise<void> {
  const expiresAt = tokens.expires_in
    ? Date.now() + tokens.expires_in * 1000
    : Date.now() + 3600 * 1000 // Default 1 hour

  const storageData: Record<string, any> = {
    [STORAGE_KEYS.ACCESS_TOKEN]: tokens.access_token,
    [STORAGE_KEYS.EXPIRES_AT]: expiresAt
  }

  if (tokens.refresh_token) {
    storageData[STORAGE_KEYS.REFRESH_TOKEN] = tokens.refresh_token
  }

  await chrome.storage.local.set(storageData)
}

/**
 * Fetch user information from the API
 */
async function fetchUserInfo(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch(OAUTH_CONFIG.USER_INFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      console.warn("Failed to fetch user info")
      return null
    }

    const userInfo = await response.json()
    
    // Store user info
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_INFO]: userInfo
    })

    return userInfo
  } catch (error) {
    console.error("Error fetching user info:", error)
    return null
  }
}

/**
 * Get the current access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<string | null> {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.EXPIRES_AT
  ])

  const accessToken = storage[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined
  const refreshToken = storage[STORAGE_KEYS.REFRESH_TOKEN] as string | undefined
  const expiresAt = storage[STORAGE_KEYS.EXPIRES_AT] as number | undefined

  if (!accessToken || !expiresAt) {
    return null
  }

  // Check if token is expired or expiring soon (within 1 minute)
  if (Date.now() > expiresAt - 60000) {
    if (!refreshToken) {
      // No refresh token available, need to re-authenticate
      await clearAuth()
      return null
    }

    // Try to refresh the token
    try {
      const newTokens = await refreshAccessToken(refreshToken)
      return newTokens.access_token
    } catch (error) {
      console.error("Token refresh failed:", error)
      await clearAuth()
      return null
    }
  }

  return accessToken
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token?: string
  expires_in?: number
}> {
  const response = await fetch(OAUTH_CONFIG.TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: OAUTH_CONFIG.CLIENT_ID,
      refresh_token: refreshToken
    })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error_description || "Token refresh failed")
  }

  const tokens = await response.json()

  if (!tokens.access_token) {
    throw new Error("No access token received during refresh")
  }

  // Store new tokens
  await storeTokens(tokens)

  return tokens
}

/**
 * Clear all authentication data
 */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
    STORAGE_KEYS.EXPIRES_AT,
    STORAGE_KEYS.USER_INFO
  ])
}

/**
 * Get current authentication state
 */
export async function getAuthState(): Promise<AuthState> {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.EXPIRES_AT,
    STORAGE_KEYS.USER_INFO
  ])

  const accessToken = storage[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined
  const expiresAt = storage[STORAGE_KEYS.EXPIRES_AT] as number | undefined
  const userInfo = storage[STORAGE_KEYS.USER_INFO] as UserInfo | undefined

  const isAuthenticated = !!(accessToken && expiresAt && Date.now() < expiresAt)

  return {
    isAuthenticated,
    isLoading: false,
    user: userInfo || null,
    error: null
  }
}

/**
 * Logout user and clear all auth data
 */
export async function logout(): Promise<void> {
  await clearAuth()
}
