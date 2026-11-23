import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildDesktopLatestYml } from './desktop-latest-yml.mjs';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeZipFixtures(arm64Content: Buffer, x64Content: Buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-latest-yml-'));
  tempDirs.push(dir);
  const arm64 = join(dir, 'MindRoom-Chat-arm64-mac.zip');
  const x64 = join(dir, 'MindRoom-Chat-x64-mac.zip');
  writeFileSync(arm64, arm64Content);
  writeFileSync(x64, x64Content);
  return { dir, arm64, x64 };
}

function sha512(buf: Buffer): string {
  return createHash('sha512').update(buf).digest('base64');
}

describe('scripts/desktop-latest-yml.mjs', () => {
  it('generates valid YAML with exact sha512, byte size, and v<version> download URLs', () => {
    const arm64Bytes = Buffer.from('arm64-zip-payload-0123456789');
    const x64Bytes = Buffer.from('x64-zip-payload-abcdef');
    const { arm64, x64 } = makeZipFixtures(arm64Bytes, x64Bytes);
    const releaseDate = '2026-11-22T18:30:00.000Z';

    const yml = buildDesktopLatestYml({
      version: '2026.11.42',
      releaseDate,
      repository: 'mindroom-ai/mindroom-chat',
      // Pass reversed order to verify arm64 is always canonical primary entry.
      files: [x64, arm64],
    });

    const parsed = parse(yml) as {
      version: string;
      files: Array<{ url: string; sha512: string; size: number }>;
      path: string;
      sha512: string;
      releaseDate: string;
    };

    const arm64Url =
      'https://github.com/mindroom-ai/mindroom-chat/releases/download/v2026.11.42/MindRoom-Chat-arm64-mac.zip';
    const x64Url =
      'https://github.com/mindroom-ai/mindroom-chat/releases/download/v2026.11.42/MindRoom-Chat-x64-mac.zip';

    expect(parsed.version).toBe('2026.11.42');
    expect(parsed.releaseDate).toBe(releaseDate);
    expect(parsed.files).toEqual([
      { url: arm64Url, sha512: sha512(arm64Bytes), size: arm64Bytes.length },
      { url: x64Url, sha512: sha512(x64Bytes), size: x64Bytes.length },
    ]);
    expect(parsed.path).toBe(arm64Url);
    expect(parsed.sha512).toBe(sha512(arm64Bytes));

    // Every file URL must carry the leading-v release tag so blockmap lookups match.
    for (const file of parsed.files) {
      expect(file.url).toMatch(
        /^https:\/\/github\.com\/mindroom-ai\/mindroom-chat\/releases\/download\/v2026\.11\.42\/MindRoom-Chat-(arm64|x64)-mac\.zip$/
      );
    }
  });

  it.each(['v2026.11.5', '2026.01.1', '2026.13.0', '2026.11.01', '1.2.3', ''])(
    'rejects malformed or leading-v version: %j',
    (version) => {
      const { arm64, x64 } = makeZipFixtures(Buffer.from('a'), Buffer.from('b'));
      expect(() =>
        buildDesktopLatestYml({
          version,
          repository: 'mindroom-ai/mindroom-chat',
          files: [arm64, x64],
        })
      ).toThrow(/Invalid version/);
    }
  );

  it('rejects missing, empty, or incomplete archive lists', () => {
    const { dir, arm64, x64 } = makeZipFixtures(Buffer.from('arm64'), Buffer.from('x64'));

    expect(() =>
      buildDesktopLatestYml({
        version: '2026.11.0',
        repository: 'mindroom-ai/mindroom-chat',
        files: [arm64],
      })
    ).toThrow(/Missing required archive/);

    expect(() =>
      buildDesktopLatestYml({
        version: '2026.11.0',
        repository: 'mindroom-ai/mindroom-chat',
        files: [arm64, join(dir, 'MindRoom-Chat-x64-mac.zip.missing')],
      })
    ).toThrow(/Unexpected archive filename/);

    const missingArm64 = join(
      mkdtempSync(join(tmpdir(), 'missing-')),
      'MindRoom-Chat-arm64-mac.zip'
    );
    tempDirs.push(join(missingArm64, '..'));
    expect(() =>
      buildDesktopLatestYml({
        version: '2026.11.0',
        repository: 'mindroom-ai/mindroom-chat',
        files: [missingArm64, x64],
      })
    ).toThrow(/Missing release archive/);

    writeFileSync(x64, '');
    expect(() =>
      buildDesktopLatestYml({
        version: '2026.11.0',
        repository: 'mindroom-ai/mindroom-chat',
        files: [arm64, x64],
      })
    ).toThrow(/Release archive is empty/);
  });

  it('writes latest-mac.yml from CLI flags', () => {
    const arm64Bytes = Buffer.from('cli-arm64');
    const x64Bytes = Buffer.from('cli-x64');
    const { dir, arm64, x64 } = makeZipFixtures(arm64Bytes, x64Bytes);
    const out = join(dir, 'out', 'latest-mac.yml');
    const releaseDate = '2026-11-22T19:00:00.000Z';

    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/desktop-latest-yml.mjs'),
        '--version',
        '2026.11.7',
        '--repo',
        'mindroom-ai/mindroom-chat',
        '--arm64',
        arm64,
        '--x64',
        x64,
        '--out',
        out,
        '--release-date',
        releaseDate,
      ],
      { encoding: 'utf8' }
    );

    expect(result.status, result.stderr).toBe(0);
    const parsed = parse(readFileSync(out, 'utf8')) as {
      version: string;
      files: Array<{ url: string; sha512: string; size: number }>;
      path: string;
      sha512: string;
      releaseDate: string;
    };
    expect(parsed.version).toBe('2026.11.7');
    expect(parsed.releaseDate).toBe(releaseDate);
    expect(parsed.files[0]?.url).toContain(
      '/releases/download/v2026.11.7/MindRoom-Chat-arm64-mac.zip'
    );
    expect(parsed.files[1]?.url).toContain(
      '/releases/download/v2026.11.7/MindRoom-Chat-x64-mac.zip'
    );
    expect(parsed.path).toBe(parsed.files[0]?.url);
    expect(parsed.sha512).toBe(sha512(arm64Bytes));
  });
});
