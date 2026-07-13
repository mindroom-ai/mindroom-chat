import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('particle background hit targets', () => {
  it('passes empty splash space through while preserving interactive controls', () => {
    const source = readSource('../splash-screen/SplashScreen.css.ts');

    expect(source).toMatch(/SplashScreenParticle[\s\S]*pointerEvents: 'none'/);
    expect(source).toContain('SplashScreenParticle} :is(a, button');
    expect(source).toMatch(/globalStyle\([\s\S]*pointerEvents: 'auto'/);
  });

  it('keeps the auth card and footer above the interactive canvas', () => {
    const source = readSource('../../pages/auth/styles.css.ts');

    expect(source).toMatch(/AuthLayout = style\([\s\S]*pointerEvents: 'none'/);
    expect(source).toMatch(/AuthCard = style\([\s\S]*pointerEvents: 'auto'/);
    expect(source).toMatch(
      /AuthFooter = style\([\s\S]*position: 'relative'[\s\S]*zIndex: 1[\s\S]*pointerEvents: 'auto'/
    );
  });
});
