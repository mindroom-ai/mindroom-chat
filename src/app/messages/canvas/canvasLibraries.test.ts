import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANVAS_LIBRARY_DIR,
  CANVAS_LIBRARY_FILES,
  inlineFonts,
} from '../../../../scripts/canvas-libraries.mjs';
import { CANVAS_LIBRARY_NAMES, canvasLibraries, canvasLibraryDirectory } from './canvasLibraries';

const DIRECTORY = 'https://chat.example/assets/canvas-libs-abc/';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canvasLibraries', () => {
  it('writes the style sheets first, then the scripts, once per library and in the order named', () => {
    const { scripts, styles, tags, unknown } = canvasLibraries(
      ['katex', 'chartjs', 'katex'],
      () => DIRECTORY
    );
    expect(styles).toEqual([`${DIRECTORY}katex.min.css`]);
    expect(scripts).toEqual([
      `${DIRECTORY}katex.min.js`,
      `${DIRECTORY}auto-render.min.js`,
      `${DIRECTORY}chart.umd.min.js`,
    ]);
    expect(unknown).toEqual([]);
    expect(tags).toBe(
      `<link rel="stylesheet" href="${DIRECTORY}katex.min.css">` +
        `<script src="${DIRECTORY}katex.min.js"></script>` +
        `<script src="${DIRECTORY}auto-render.min.js"></script>` +
        `<script src="${DIRECTORY}chart.umd.min.js"></script>`
    );
  });

  it('allows no file for a page that names none Chat serves, and lists the unknown names', () => {
    const directory = vi.fn(() => DIRECTORY);
    const none = { scripts: [], styles: [], tags: '' };
    expect(canvasLibraries(['plotly', 'toString', '__proto__'], directory)).toEqual({
      ...none,
      unknown: ['plotly', 'toString', '__proto__'],
    });
    expect(canvasLibraries(undefined, directory)).toEqual({ ...none, unknown: [] });
    expect(directory).not.toHaveBeenCalled();
    expect(canvasLibraries(['d3', 'three'], () => DIRECTORY).unknown).toEqual(['three']);
  });

  it("names the directory by Chat's own address and base path", () => {
    vi.stubGlobal('window', { location: { href: 'capacitor://localhost/rooms/!a?x=1#y' } });
    expect(canvasLibraryDirectory()).toBe('capacitor://localhost/assets/canvas-libs/');
    vi.stubGlobal('__APP_BASE_PATH__', '/chat');
    vi.stubGlobal('window', { location: { href: 'https://example.org/chat/rooms' } });
    expect(canvasLibraryDirectory()).toBe('https://example.org/chat/assets/canvas-libs/');
  });

  it('ships every file a library names, in a directory named by their contents', () => {
    const names = CANVAS_LIBRARY_FILES.map(({ name }) => name);
    const tags = canvasLibraries(CANVAS_LIBRARY_NAMES, () => '/').tags;
    const referenced = [...tags.matchAll(/(?:href|src)="\/([^"]+)"/g)].map((match) => match[1]);
    expect(referenced.sort()).toEqual([...names].sort());
    expect(CANVAS_LIBRARY_DIR).toMatch(/^assets\/canvas-libs-[0-9a-f]{12}$/);
  });

  it("puts KaTeX's fonts in its style sheet, so the page loads no font from Chat's origin", () => {
    const css = CANVAS_LIBRARY_FILES.find(
      ({ name }) => name === 'katex.min.css'
    )?.source.toString();
    expect(css).toMatch(/@font-face/);
    expect(css).not.toMatch(/url\((?!data:font\/woff2;base64,)/);
    expect(css?.match(/src:/g)?.length).toBe(css?.match(/data:font\/woff2/g)?.length);
  });

  it('keeps only the woff2 face of each font, and fails on a font without one', () => {
    const fonts = fileURLToPath(new URL('../../../../node_modules/katex/dist/', import.meta.url));
    const font = readFileSync(`${fonts}fonts/KaTeX_Main-Regular.woff2`).toString('base64');
    expect(
      inlineFonts(
        '@font-face{font-family:A;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff")}',
        fonts
      )
    ).toBe(`@font-face{font-family:A;src:url(data:font/woff2;base64,${font}) format("woff2")}`);
    expect(() => inlineFonts('@font-face{src:url(a.ttf)}', fonts)).toThrow('No woff2 font');
  });
});
