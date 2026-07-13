import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const readExportBlock = (relativePath: string, exportName: string) => {
  const source = readSource(relativePath);
  const start = source.indexOf(`export const ${exportName} =`);
  if (start === -1) throw new Error(`Missing export: ${exportName}`);

  const nextExport = source.indexOf('\nexport const ', start + 1);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
};

describe('particle background hit targets', () => {
  it('passes empty splash space through while preserving interactive controls', () => {
    const sourcePath = '../splash-screen/SplashScreen.css.ts';
    const source = readSource(sourcePath);
    const splashParticle = readExportBlock(sourcePath, 'SplashScreenParticle');

    expect(splashParticle).toContain("pointerEvents: 'none'");
    expect(source).toContain('SplashScreenParticle} :is(a, button');
    expect(source).toContain("[tabindex]:not([tabindex='-1'])");
    expect(source).toContain("pointerEvents: 'auto'");
  });

  it('keeps the auth card and footer above the interactive canvas', () => {
    const sourcePath = '../../pages/auth/styles.css.ts';
    const authLayout = readExportBlock(sourcePath, 'AuthLayout');
    const authCard = readExportBlock(sourcePath, 'AuthCard');
    const authFooter = readExportBlock(sourcePath, 'AuthFooter');

    expect(authLayout).toContain("pointerEvents: 'none'");
    expect(authCard).toContain("pointerEvents: 'auto'");
    expect(authFooter).toContain("position: 'relative'");
    expect(authFooter).toContain('zIndex: 1');
    expect(authFooter).toContain("pointerEvents: 'auto'");
  });
});
