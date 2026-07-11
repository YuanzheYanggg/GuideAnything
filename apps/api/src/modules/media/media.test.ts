import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorization, createTestContext, type TestContext } from '../../test/test-app';

describe('media upload and read', () => {
  let context: TestContext;
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'guideanything-media-'));
    context = await createTestContext({ uploadDir });
  });

  afterEach(async () => {
    await context.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('stores an authenticated PNG under a generated name and serves it with safe headers', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('demo')]);
    const upload = await context.app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { ...authorization(context.tokens.author), ...multipartHeaders('erp-screen.png', 'image/png') },
      payload: multipartBody('erp-screen.png', 'image/png', png),
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json().asset).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', size: png.length });
    const assetId = upload.json().asset.id as string;
    const row = context.database.prepare('SELECT storage_path FROM media_assets WHERE id = ?').get(assetId) as { storage_path: string };
    expect(readFileSync(row.storage_path)).toEqual(png);
    expect(row.storage_path.startsWith(uploadDir)).toBe(true);
    expect(row.storage_path).not.toContain('erp-screen');

    const unauthenticatedRead = await context.app.inject({ method: 'GET', url: `/api/media/${assetId}` });
    expect(unauthenticatedRead.statusCode).toBe(401);

    const read = await context.app.inject({
      method: 'GET', url: `/api/media/${assetId}`, headers: authorization(context.tokens.learner),
    });
    expect(read.statusCode).toBe(200);
    expect(read.rawPayload).toEqual(png);
    expect(read.headers['content-type']).toContain('image/png');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(read.headers['cache-control']).toContain('private');
  });

  it('rejects unsupported SVG and spoofed PNG bytes', async () => {
    const svg = await upload('diagram.svg', 'image/svg+xml', Buffer.from('<svg></svg>'));
    expect(svg.statusCode).toBe(415);
    expect(svg.json().code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const spoofed = await upload('fake.png', 'image/png', Buffer.from('not a png'));
    expect(spoofed.statusCode).toBe(415);
    expect(spoofed.json().code).toBe('MEDIA_SIGNATURE_MISMATCH');
  });

  it('rejects images larger than 10 MiB and unauthenticated uploads', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const oversized = Buffer.concat([pngHeader, Buffer.alloc(10 * 1024 * 1024)]);
    const response = await upload('large.png', 'image/png', oversized);
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('MEDIA_TOO_LARGE');

    const unauthenticated = await context.app.inject({
      method: 'POST',
      url: '/api/media',
      headers: multipartHeaders('erp-screen.png', 'image/png'),
      payload: multipartBody('erp-screen.png', 'image/png', pngHeader),
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  async function upload(filename: string, mimeType: string, bytes: Buffer) {
    return context.app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { ...authorization(context.tokens.author), ...multipartHeaders(filename, mimeType) },
      payload: multipartBody(filename, mimeType, bytes),
    });
  }
});

const boundary = '----guideanything-test-boundary';

function multipartHeaders(filename: string, mimeType: string) {
  void filename;
  void mimeType;
  return { 'content-type': `multipart/form-data; boundary=${boundary}` };
}

function multipartBody(filename: string, mimeType: string, bytes: Buffer): Buffer {
  const start = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const end = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([start, bytes, end]);
}
