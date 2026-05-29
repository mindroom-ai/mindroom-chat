import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MindRoom custom HTML ownership', () => {
  it('keeps fork-specific sanitizer and rendering policy out of generic modules', () => {
    const sanitizeSource = readFileSync(
      new URL('../../utils/sanitize.ts', import.meta.url),
      'utf8'
    );
    const parserSource = readFileSync(
      new URL('../../plugins/react-custom-html-parser.tsx', import.meta.url),
      'utf8'
    );
    const customHtmlStyleSource = readFileSync(
      new URL('../../styles/CustomHtml.css.ts', import.meta.url),
      'utf8'
    );
    const policySource = readFileSync(new URL('./customHtmlPolicy.ts', import.meta.url), 'utf8');
    const rendererSource = readFileSync(
      new URL('./customHtmlRenderers.tsx', import.meta.url),
      'utf8'
    );
    const mathStyleSource = readFileSync(new URL('./MatrixMath.css.ts', import.meta.url), 'utf8');

    expect(sanitizeSource).not.toContain('data-mindroom-paste-marker');
    expect(sanitizeSource).not.toContain('data-mx-maths');
    expect(sanitizeSource).not.toContain("'think'");
    expect(sanitizeSource).not.toContain("'analysis'");
    expect(sanitizeSource).toContain('mindroomCustomHtmlSanitizerPolicy');

    expect(parserSource).not.toContain('renderMindroomHtmlBlock');
    expect(parserSource).not.toContain('data-mx-maths');
    expect(parserSource).toContain('renderMindroomCustomHtmlElement');

    expect(customHtmlStyleSource).not.toContain('MathInline');
    expect(customHtmlStyleSource).not.toContain('MathBlock');
    expect(customHtmlStyleSource).not.toContain('PasteMarkerBadge');

    expect(policySource).toContain('data-mindroom-paste-marker');
    expect(policySource).toContain('data-mx-maths');
    expect(rendererSource).toContain('renderMindroomHtmlBlock');
    expect(mathStyleSource).toContain('MathInline');
    expect(mathStyleSource).toContain('MathBlock');
  });
});
