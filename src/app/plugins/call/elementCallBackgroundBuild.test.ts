import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { copyFiles } from '../../../../vite.config';
import { injectElementCallTransparentBackground } from '../../../../scripts/element-call-background.mjs';

const elementCallIndexPath = path.resolve(
  'node_modules/@element-hq/element-call-embedded/dist/index.html'
);

describe('Element Call background build', () => {
  it('copies the real Element Call index through the transparency transform', () => {
    expect(copyFiles.targets).toContainEqual(
      expect.objectContaining({
        src: 'node_modules/@element-hq/element-call-embedded/dist/index.html',
        dest: 'public/element-call',
        transform: injectElementCallTransparentBackground,
      })
    );

    const source = fs.readFileSync(elementCallIndexPath, 'utf8');
    const html = injectElementCallTransparentBackground(source);
    const override = '<style>html,body{background-color:transparent!important}</style>';

    expect(html).toContain(`<head>${override}`);
    expect(html.indexOf(override)).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it('fails the build if an upstream index no longer has the expected head', () => {
    expect(() => injectElementCallTransparentBackground('<html></html>')).toThrow(
      'Element Call index is missing its <head> element'
    );
  });
});
