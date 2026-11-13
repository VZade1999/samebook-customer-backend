import * as crypto from 'crypto';
import { getAccessSecret } from '../../auth/jwt.util';

// Secrets of lead sources (the IndiaMART API key, the token in a webhook URL)
// are stored AES-256-GCM encrypted. The key is derived from CRM_SECRET_KEY when
// set, else from the access-token secret (as Drive does for upload signing).
// If that secret is ever rotated, stored secrets stop decrypting: the source
// shows "Reconnect" and the admin re-enters the key / regenerates the URL.

let cachedKey: Buffer | null = null;
const key = (): Buffer => {
  if (cachedKey) return cachedKey;
  const base = process.env.CRM_SECRET_KEY || getAccessSecret();
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', base, 'samebook-crm', 'lead-source-secrets:v1', 32));
  return cachedKey;
};

export interface SourceSecrets {
  token?: string;
  api_key?: string;
}

export const sealSecrets = (s: SourceSecrets): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(s), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), body.toString('base64url'), tag.toString('base64url')].join('.');
};

/** null when missing or undecryptable (e.g. the server secret changed). */
export const openSecrets = (sealed?: string | null): SourceSecrets | null => {
  if (!sealed) return null;
  try {
    const [v, iv, body, tag] = sealed.split('.');
    if (v !== 'v1' || !iv || !body || !tag) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const json = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
};

/** 32 URL-safe characters (192 bits). */
export const newIntakeToken = () => crypto.randomBytes(24).toString('base64url');

export const tokenHash = (token: string) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** "••••••••3f9a": enough to recognise a key without showing it. */
export const maskSecret = (s?: string | null) => (s ? `••••••••${String(s).slice(-4)}` : null);
