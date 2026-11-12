import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

export interface TokenPayload {
  userId: number;
  companyId: number;
  email: string;
  roles: string[];
  permissions: string[];
}

function getSecret(
  name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  devFallback: string,
): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set via environment variable in production`);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[auth] ${name} not set — using an insecure dev-only fallback. Set it in .env.local.`,
  );
  return devFallback;
}

// Read lazily, NOT at import time: this file is imported while AppModule is
// still being loaded — before ConfigModule has read .env.local into
// process.env — so a module-level read silently fell back to the dev secret
// locally. Cached after the first read; assertJwtSecrets() (called from
// main.ts once config is loaded) keeps the fail-fast check in production.
let accessSecret: string | undefined;
let refreshSecret: string | undefined;
const ACCESS = () =>
  (accessSecret ??= getSecret('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'));
const REFRESH = () =>
  (refreshSecret ??= getSecret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me'));

/** The access-token secret, resolved exactly like auth does (for derived keys). */
export const getAccessSecret = (): string => ACCESS();

/** Resolve both secrets at startup (throws in production if missing). */
export const assertJwtSecrets = (): void => {
  ACCESS();
  REFRESH();
};

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const signAccessToken = (payload: TokenPayload): string =>
  jwt.sign(payload, ACCESS(), { expiresIn: '15m' });

export const signRefreshToken = (payload: TokenPayload): string =>
  // jti prevents two rotations issued within the same second from producing an
  // identical token string (jwt 'iat' has 1s resolution), which would collide
  // against the UNIQUE token_hash constraint on refresh_tokens.
  jwt.sign({ ...payload, jti: crypto.randomUUID() }, REFRESH(), { expiresIn: '7d' });

export const verifyAccessToken = (token: string): TokenPayload =>
  jwt.verify(token, ACCESS()) as unknown as TokenPayload;

export const verifyRefreshToken = (token: string): TokenPayload =>
  jwt.verify(token, REFRESH()) as unknown as TokenPayload;

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
