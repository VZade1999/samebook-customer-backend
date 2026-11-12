import { CHUNK_BYTES, DriveStorage } from './drive.storage';

// Offline: pre-signing is pure computation, no request reaches S3.
describe('DriveStorage', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const s3Env = () => {
    process.env.DRIVE_STORAGE = 's3';
    process.env.DRIVE_S3_BUCKET = 'samebook-drive-test';
    process.env.DRIVE_S3_REGION = 'ap-south-1';
    process.env.DRIVE_S3_ACCESS_KEY_ID = 'AKIATESTTESTTESTTEST';
    process.env.DRIVE_S3_SECRET_ACCESS_KEY = 'secretsecretsecretsecretsecretsecretsecr';
    delete process.env.DRIVE_S3_ENDPOINT;
  };

  it('picks the mode from env (database by default)', () => {
    const s = new DriveStorage();
    delete process.env.DRIVE_STORAGE;
    delete process.env.DRIVE_S3_BUCKET;
    expect(s.mode).toBe('db');
    process.env.DRIVE_S3_BUCKET = 'b';
    expect(s.mode).toBe('s3');
    process.env.DRIVE_STORAGE = 'db';
    expect(s.mode).toBe('db');
    process.env.DRIVE_STORAGE = 'local';
    expect(s.mode).toBe('local');
    process.env.DRIVE_STORAGE = 's3';
    delete process.env.DRIVE_S3_BUCKET;
    expect(s.mode).toBe('unconfigured');
  });

  it('db uploads are chunked through the API and parts are size-checked', async () => {
    delete process.env.DRIVE_STORAGE;
    delete process.env.DRIVE_S3_BUCKET;
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    const s = new DriveStorage();
    const t = await s.uploadTarget(1, s.newKey(1, 'pdf'), 'application/pdf', 25 * 1024 * 1024);
    expect(t.via_api).toBe(true);
    expect(t.chunk_size).toBe(CHUNK_BYTES);
    const { Readable } = await import('stream');
    await expect(s.receivePart('k', 13, Readable.from([Buffer.alloc(1)]), 25 * 1024 * 1024)).rejects.toMatchObject({ status: 400 });
    await expect(
      s.receivePart('k', 0, Readable.from([Buffer.alloc(CHUNK_BYTES), Buffer.alloc(1)]), 25 * 1024 * 1024),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('generates company-scoped keys and validates them', () => {
    const s = new DriveStorage();
    const key = s.newKey(7, 'pdf');
    expect(key).toMatch(/^c7\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(s.isCompanyKey(key, 7)).toBe(true);
    expect(s.isCompanyKey(key, 70)).toBe(false);
    expect(s.isCompanyKey('c7/../../etc/passwd', 7)).toBe(false);
    expect(s.extOfKey(key)).toBe('pdf');
  });

  it('pre-signs a direct PUT to the bucket with the content type', async () => {
    s3Env();
    const s = new DriveStorage();
    const t = await s.uploadTarget(1, 'c1/2026/11/11111111-1111-1111-1111-111111111111.pdf', 'application/pdf', 1000);
    expect(t.via_api).toBe(false);
    expect(t.method).toBe('PUT');
    expect(t.headers['Content-Type']).toBe('application/pdf');
    const u = new URL(t.url);
    expect(u.hostname).toContain('samebook-drive-test');
    expect(u.pathname).toBe('/c1/2026/11/11111111-1111-1111-1111-111111111111.pdf');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('1800');
    // Only host is signed, so the browser's Content-Type can't break the
    // signature; downloads always use the type stored in the DB anyway.
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    // No CRC checksum params a browser couldn't satisfy.
    expect(t.url).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum/i);
  });

  it('pre-signs downloads with disposition and a 15 minute expiry', async () => {
    s3Env();
    const s = new DriveStorage();
    const url = new URL(
      await s.signedLink('c1/2026/11/11111111-1111-1111-1111-111111111111.pdf', {
        filename: 'रिपोर्ट "Q4".pdf',
        mime: 'application/pdf',
        inline: true,
      }),
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    const disp = url.searchParams.get('response-content-disposition')!;
    expect(disp).toMatch(/^inline; filename="_+ _Q4_\.pdf"; filename\*=UTF-8''/);
    expect(decodeURIComponent(disp.split("UTF-8''")[1])).toBe('रिपोर्ट "Q4".pdf');
  });

  it('local mode uploads go through a signed API route', async () => {
    process.env.DRIVE_STORAGE = 'local';
    delete process.env.DRIVE_S3_BUCKET;
    delete process.env.VERCEL;
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    const s = new DriveStorage();
    const key = s.newKey(3, 'txt');
    const t = await s.uploadTarget(3, key, 'text/plain', 99);
    expect(t.via_api).toBe(true);
    const token = t.url.replace('/drive/uploads/', '');
    expect(s.verifyUploadToken(token)).toEqual({ key, companyId: 3, maxBytes: 99 });
    expect(s.verifyUploadToken(token + 'x')).toBeNull();
  });
});
