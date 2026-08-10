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

const ACCESS_SECRET = getSecret('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me');
const REFRESH_SECRET = getSecret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me');

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const signAccessToken = (payload: TokenPayload): string =>
  jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });

export const signRefreshToken = (payload: TokenPayload): string =>
  // jti prevents two rotations issued within the same second from producing an
  // identical token string (jwt 'iat' has 1s resolution), which would collide
  // against the UNIQUE token_hash constraint on refresh_tokens.
  jwt.sign({ ...payload, jti: crypto.randomUUID() }, REFRESH_SECRET, { expiresIn: '7d' });

export const verifyAccessToken = (token: string): TokenPayload =>
  jwt.verify(token, ACCESS_SECRET) as unknown as TokenPayload;

export const verifyRefreshToken = (token: string): TokenPayload =>
  jwt.verify(token, REFRESH_SECRET) as unknown as TokenPayload;

export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
