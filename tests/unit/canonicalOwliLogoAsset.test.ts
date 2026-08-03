import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSET_PATH = path.resolve('public/assets/branding/owli-video-branding-logo.png');
const EXPECTED_BYTES = 948_271;
const EXPECTED_SHA256 = '6b670bcc0223adf70b94c0284b68252a79f89b67e4a1713e2d0e67ecd7bbea18';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

describe('canonical Owli video branding asset', () => {
  it('keeps the user-provided Android asset byte-identical and build-addressable', async () => {
    const bytes = await readFile(ASSET_PATH);

    expect(bytes.byteLength).toBe(EXPECTED_BYTES);
    expect(Array.from(bytes.subarray(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(EXPECTED_SHA256);
  });
});
