import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const getStyleBody = (source: string, exportName: string): string => {
  const body = source.match(
    new RegExp(`export const ${exportName} = style\\(\\{([\\s\\S]*?)\\n\\}\\);`)
  )?.[1];

  expect(body, `Expected to find the ${exportName} style`).toBeDefined();
  return body ?? '';
};

const getRemPixels = (styleBody: string, property: 'width' | 'maxWidth'): number => {
  const pixels = styleBody.match(new RegExp(`${property}: toRem\\((\\d+)\\)`))?.[1];

  expect(pixels, `Expected ${property} to use a numeric toRem value`).toBeDefined();
  return Number(pixels);
};

describe('Mindroom model badge avatar layout', () => {
  it('centers the badge without widening the standard size-300 avatar column', () => {
    const messageStyles = readSource('../../features/room/message/styles.css.ts');
    const badgeStyles = readSource('./MindroomModelBadge.css.ts');
    const messageSource = readSource('./MindroomMessage.tsx');
    const avatarStack = getStyleBody(messageStyles, 'MessageAvatarWithModel');
    const badge = getStyleBody(badgeStyles, 'Badge');
    const avatarColumnWidth = getRemPixels(avatarStack, 'width');
    const badgeMaxWidth = getRemPixels(badge, 'maxWidth');
    const standardMessageGap = 12;

    expect(messageSource).toMatch(/<Avatar[\s\S]*?size="300"/);
    expect(avatarStack).toContain("alignItems: 'center'");
    expect(avatarColumnWidth).toBe(36);
    expect(badgeMaxWidth).toBeGreaterThan(avatarColumnWidth);
    expect(badgeMaxWidth).toBe(avatarColumnWidth + standardMessageGap * 2);
  });
});
