# OAuth 2.0 + PKCE Authentication Configuration

## Overview
This document describes the OAuth 2.0 authentication implementation for the QNote Clipper browser extension.

## Architecture

The extension uses **OAuth 2.0 Authorization Code Flow with PKCE** to authenticate users with the QTable Web application. This is the recommended approach for browser extensions as it provides:

- **Security**: No client secret required, PKCE prevents authorization code interception attacks
- **User Experience**: Seamless login through the web application
- **Token Management**: Automatic token refresh without user intervention

## Configuration

### 1. Update OAuth Endpoints in `utils/auth.ts`

Edit the `OAUTH_CONFIG` object at the top of `utils/auth.ts`:

```typescript
const OAUTH_CONFIG = {
  // Your QTable Web OAuth authorization endpoint
  AUTHORIZATION_ENDPOINT: "https://qtable.example.com/oauth/authorize",
  
  // Your QTable Web token endpoint
  TOKEN_ENDPOINT: "https://qtable.example.com/oauth/token",
  
  // Optional: User info endpoint
  USER_INFO_ENDPOINT: "https://qtable.example.com/api/user/me",
  
  // OAuth client ID (registered in QTable)
  CLIENT_ID: "note-script-clipper",
  
  // Requested scopes
  SCOPE: "openid profile email"
}
```

### 2. Register OAuth Client in QTable Web Application

In your QTable Web application's OAuth provider configuration, register a new client:

- **Client ID**: `note-script-clipper` (or your preferred identifier)
- **Client Type**: Public (no client secret)
- **Grant Types**: `authorization_code`, `refresh_token`
- **Redirect URIs**: The extension will dynamically generate redirect URIs in the format:
  ```
  https://<EXTENSION_ID>.chromiumapp.org/
  ```
  
  For development, you can find your extension ID at `chrome://extensions/` after loading the unpacked extension.

- **PKCE Required**: Yes (S256 method)
- **Scopes**: `openid`, `profile`, `email` (adjust based on your needs)

### 3. QTable Web API Endpoints

Your QTable Web application must implement these endpoints:

#### Authorization Endpoint
```
GET /oauth/authorize
```

**Query Parameters:**
- `response_type`: `code`
- `client_id`: Your registered client ID
- `redirect_uri`: Extension's chromiumapp.org URL
- `code_challenge`: PKCE code challenge (base64url encoded SHA-256 hash)
- `code_challenge_method`: `S256`
- `scope`: Requested scopes (space-separated)

**Behavior:**
1. If user is not logged in, show login page
2. After login, show consent/authorization page
3. On approval, redirect to `redirect_uri` with `code` parameter:
   ```
   https://<EXTENSION_ID>.chromiumapp.org/?code=<AUTHORIZATION_CODE>
   ```

#### Token Endpoint
```
POST /oauth/token
Content-Type: application/json
```

**Request Body (Authorization Code Grant):**
```json
{
  "grant_type": "authorization_code",
  "client_id": "note-script-clipper",
  "code": "<AUTHORIZATION_CODE>",
  "redirect_uri": "https://<EXTENSION_ID>.chromiumapp.org/",
  "code_verifier": "<PKCE_VERIFIER>"
}
```

**Request Body (Refresh Token Grant):**
```json
{
  "grant_type": "refresh_token",
  "client_id": "note-script-clipper",
  "refresh_token": "<REFRESH_TOKEN>"
}
```

**Response:**
```json
{
  "access_token": "<JWT_ACCESS_TOKEN>",
  "refresh_token": "<REFRESH_TOKEN>",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

#### User Info Endpoint (Optional but Recommended)
```
GET /api/user/me
Authorization: Bearer <ACCESS_TOKEN>
```

**Response:**
```json
{
  "id": "user_123",
  "name": "John Doe",
  "email": "john@example.com",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

## How It Works

### Login Flow

1. **User clicks "Login"** in the extension sidepanel
2. Extension generates PKCE verifier and challenge
3. Extension calls `chrome.identity.launchWebAuthFlow()` which opens a browser window to the authorization endpoint
4. User logs in to QTable Web (if not already logged in) and authorizes the extension
5. QTable redirects to the extension's special `chromiumapp.org` URL with an authorization code
6. Chrome captures this redirect and returns the URL to the extension
7. Extension exchanges the authorization code + PKCE verifier for access and refresh tokens
8. Extension fetches user info and stores everything in `chrome.storage.local`
9. Extension updates settings with user information
10. UI reflects logged-in state

### API Requests

All authenticated API requests automatically include the access token:

```typescript
import { getValidAccessToken } from "~utils/auth"

async function makeAuthenticatedRequest() {
  const token = await getValidAccessToken()
  
  if (!token) {
    throw new Error("Not authenticated")
  }
  
  const response = await fetch('https://api.example.com/data', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  
  return await response.json()
}
```

The `authenticatedFetch` helper in `utils/api.ts` handles this automatically.

### Token Refresh

Access tokens are automatically refreshed before expiration:

1. Before each API request, `getValidAccessToken()` checks if the token is expired or expiring soon (within 1 minute)
2. If expired, it uses the refresh token to get a new access token
3. If refresh fails (e.g., refresh token expired), the user is logged out and must re-authenticate

### Logout

When user clicks "Logout":
1. All tokens and user info are cleared from storage
2. Settings are updated to reflect logged-out state
3. UI updates accordingly

## Storage

The extension uses Chrome's storage APIs to persist authentication data:

### chrome.storage.local (Persistent)
- `oauth_access_token`: Current access token
- `oauth_refresh_token`: Refresh token for obtaining new access tokens
- `oauth_expires_at`: Timestamp when access token expires (milliseconds since epoch)
- `oauth_user_info`: User profile information

### chrome.storage.session (Temporary, cleared on browser restart)
- `oauth_pkce_verifier`: PKCE code verifier (only during authorization flow)

## Security Considerations

1. **PKCE**: Protects against authorization code interception attacks
2. **No Client Secret**: As a public client, the extension doesn't store any secrets
3. **Secure Redirect**: Chrome's `chromiumapp.org` redirect URIs are unique per extension and cannot be intercepted by other extensions
4. **Token Storage**: Tokens are stored in Chrome's encrypted storage (on most platforms)
5. **Short-lived Access Tokens**: Access tokens should have limited lifetime (e.g., 1 hour)
6. **Refresh Token Rotation**: If supported by your OAuth server, implement refresh token rotation for enhanced security

## Testing

### Development Mode

1. Load the unpacked extension in Chrome (`chrome://extensions/`)
2. Note the extension ID (32-character string)
3. Add `https://<EXTENSION_ID>.chromiumapp.org/` to allowed redirect URIs in QTable
4. Click "Login" in the extension
5. Complete the OAuth flow
6. Verify tokens are stored in `chrome.storage.local`

### Debugging

Open Chrome DevTools for the extension:
- **Service Worker**: Right-click the extension in `chrome://extensions/` → "Inspect views: Service Worker"
- **Sidepanel**: Open the sidepanel, right-click → "Inspect"

Check console logs for OAuth flow details and errors.

## Migration from Mock Authentication

The previous mock authentication (toggling `loggedIn` boolean) has been replaced with real OAuth. To migrate:

1. ✅ Remove mock login toggle buttons (already done)
2. ✅ Implement real OAuth flow (completed)
3. 🔄 Update API endpoints in `utils/api.ts` to use `authenticatedFetch` (templates provided, uncomment when ready)
4. 🔄 Configure actual QTable OAuth endpoints in `utils/auth.ts`
5. 🔄 Test the complete flow with your QTable deployment

## Troubleshooting

### "Login failed" error
- Check that OAuth endpoints are correctly configured
- Verify the extension ID matches the registered redirect URI
- Check browser console for detailed error messages
- Ensure QTable OAuth server is running and accessible

### Token refresh fails
- Check if refresh token has expired
- Verify token endpoint is accessible
- Check network tab for HTTP errors
- User may need to re-authenticate

### CORS issues
- Service Worker requests are not subject to CORS restrictions
- If making requests from content scripts, ensure proper CORS headers on your API

## Next Steps

1. Configure your QTable OAuth server with the correct endpoints
2. Update `OAUTH_CONFIG` in `utils/auth.ts` with your actual URLs
3. Uncomment the authenticated API calls in `utils/api.ts`
4. Test the complete authentication flow
5. Deploy and monitor for any issues

## References

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://tools.ietf.org/html/rfc8252)
- [PKCE (RFC 7636)](https://tools.ietf.org/html/rfc7636)
- [OAuth 2.0 Best Practices for Browser Extensions](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
