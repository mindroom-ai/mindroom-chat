import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every icon the web shell, the web app manifest and the native shells name must ship.
// scripts/generate-web-icons.sh makes the web ones from public/res/branding/.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(repoRoot, 'public');
const readText = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const pngSize = (path: string) => {
  const header = readFileSync(path).subarray(0, 24);
  expect(header.subarray(1, 4).toString('ascii'), `${path} is not a PNG`).toBe('PNG');
  return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`;
};

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
const manifestIcons: ManifestIcon[] = JSON.parse(readText('public/manifest.json')).icons;

describe('web app manifest icons', () => {
  it.each(manifestIcons.map((icon) => [icon.src, icon]))(
    '%s exists with the declared size',
    (_src, icon) => {
      const path = join(publicDir, icon.src);
      expect(existsSync(path)).toBe(true);
      expect(icon.type).toBe('image/png');
      expect(pngSize(path)).toBe(icon.sizes);
    }
  );

  it('offers 192 and 512 pixel icons for both purposes', () => {
    const offered = manifestIcons.map((icon) => `${icon.purpose ?? 'any'} ${icon.sizes}`).sort();
    expect(offered).toEqual(['any 192x192', 'any 512x512', 'maskable 192x192', 'maskable 512x512']);
  });
});

describe('index.html icons', () => {
  const links = [
    ...readText('index.html').matchAll(/<link\b[^>]*\brel="(icon|apple-touch-icon)"[^>]*>/g),
  ].map(([tag, rel]) => ({ rel, href: /\bhref="\/([^"]+)"/.exec(tag)?.[1] }));

  it('links a favicon and an Apple touch icon', () => {
    expect(links.map(({ rel }) => rel)).toEqual(
      expect.arrayContaining(['icon', 'apple-touch-icon'])
    );
  });

  it.each(links.map(({ href }) => [href]))('/%s exists in public/', (href) => {
    expect(href && existsSync(join(publicDir, href))).toBe(true);
  });

  it('gives iOS an opaque 180 pixel touch icon', () => {
    const touch = links.find(({ rel }) => rel === 'apple-touch-icon');
    const path = join(publicDir, touch?.href ?? '');
    expect(pngSize(path)).toBe('180x180');
    // PNG color type 2 is RGB without alpha; iOS fills transparency with black.
    expect(readFileSync(path)[25]).toBe(2);
  });
});

describe('native shell icons', () => {
  it.each([
    'ios/App/App/Assets.xcassets/AppIcon.appiconset',
    'ios/App/App/Assets.xcassets/Splash.imageset',
  ])('every image %s names exists', (catalog) => {
    const { images } = JSON.parse(readText(`${catalog}/Contents.json`)) as {
      images: { filename?: string }[];
    };
    const missing = images
      .map(({ filename }) => filename)
      .filter((filename) => !filename || !existsSync(join(repoRoot, catalog, filename)));
    expect(missing).toEqual([]);
  });

  it('every Android mipmap and drawable reference resolves to a resource', () => {
    const res = join(repoRoot, 'android/app/src/main/res');
    const resources = new Set(
      readdirSync(res)
        .filter((dir) => /^(mipmap|drawable)(-|$)/.test(dir))
        .flatMap((dir) =>
          readdirSync(join(res, dir)).map((file) => `${dir.split('-')[0]}/${file.split('.')[0]}`)
        )
    );
    const sources = [
      'android/app/src/main/AndroidManifest.xml',
      ...readdirSync(res, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.xml'))
        .map((file) => `android/app/src/main/res/${file}`),
    ];
    const references = sources.flatMap((source) =>
      [...readText(source).matchAll(/@(mipmap|drawable)\/(\w+)/g)].map(
        ([, kind, name]) => `${kind}/${name}`
      )
    );
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter((reference) => !resources.has(reference))).toEqual([]);
  });
});
