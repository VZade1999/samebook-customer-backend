import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from './jwt.util';

export type CookieTokenType = 'access' | 'refresh';

/**
 * Single source of truth for cookie flags, used by every set/clear call site
 * (login, logout, refresh) so they can never drift out of sync with each other
 * again — that mismatch used to make logout silently fail to clear cookies in
 * some browsers.
 *
 * secure:true + sameSite:'none' unconditionally: the frontend and this API are
 * cross-origin even in local dev (localhost:5173 vs localhost:3010), so
 * SameSite=None is required for the cookie to be sent on cross-origin requests
 * at all. secure:true is safe on localhost specifically — browsers exempt
 * http://localhost from the "Secure requires HTTPS" rule.
 */
export function getCookieOptions(type: CookieTokenType) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: type === 'access' ? ACCESS_TOKEN_TTL_MS : REFRESH_TOKEN_TTL_MS,
  };
}
