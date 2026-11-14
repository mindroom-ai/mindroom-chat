import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The ESLint rule of .eslintrc.cjs that keeps physical sides (left, right) out of the styles of
// src, so the interface mirrors in right-to-left languages. Made-up paths get the rule by pattern.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
const STYLE_FILE = 'src/app/ui/Example.css.ts';
const COMPONENT = 'src/app/ui/Example.tsx';

const physicalSides = async (source: string, filePath: string) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax');
};

const styleFile = (body: string) =>
  `import { globalStyle, style } from '@vanilla-extract/css';\n\nconst a = '1px';\nconst b = '2px';\nconst c = '3px';\nconst d = '4px';\nconst withMargin = (inset: string) => \`calc(\${inset} + 4px)\`;\n${body}\n`;

describe('logical sides in styles', () => {
  it.each([
    'export const x = style({ marginLeft: a });',
    'export const x = style({ paddingRight: a });',
    "export const x = style({ borderLeft: '1px solid' });",
    'export const x = style({ borderRightColor: a });',
    'export const x = style({ borderTopRightRadius: a });',
    "export const x = style({ 'margin-left': a });",
    "export const x = style({ position: 'absolute', left: 0 });",
    'export const x = style({ right: a });',
    "globalStyle('.x', { right: a });",
    "export const x = style({ selectors: { '& + &': { marginLeft: a } } });",
    "export const x = style({ textAlign: 'left' });",
    "export const x = style({ float: 'right' });",
    "export const x = style({ justifyContent: 'left' });",
    "export const x = style({ padding: '0 8px 0 4px' });",
    "export const x = style({ inset: '0 auto auto 0' });",
    "export const x = style({ margin: 'calc(1px + 2px) 0 0 calc(3px - 1px)' });",
    'export const x = style({ padding: `0 ${b} 0 ${d}` });',
    'export const x = style({ padding: `${a} ${b} ${c} ${d}` });',
    'export const x = style({ margin: `${a} ${b} 0 0` });',
    'export const x = style({ padding: `0 0 ${c} ${d}` });',
    // Several radii name corners by their physical sides; each side of a slash counts.
    "export const x = style({ borderRadius: '4px 0' });",
    "export const x = style({ borderRadius: '4px 8px 0 0' });",
    "export const x = style({ 'border-radius': '10px 20px / 5px' });",
    'export const x = style({ borderRadius: `${a} ${b}` });',
    // Positions by keyword.
    "export const x = style({ transformOrigin: 'left top' });",
    "export const x = style({ backgroundPosition: 'right 8px center' });",
    'export const x = style({ objectPosition: `left ${a}` });',
    // A keyword wrapped for its type.
    "export const x = style({ textAlign: 'left' as const });",
    "export const x = style({ float: 'right' satisfies string });",
    "export const x = style({ padding: '0 8px 0 4px' as const });",
    // A choice between a safe-area inset and a plain side is physical in its other branch.
    "export const x = style({ marginLeft: a ? 'env(safe-area-inset-left)' : '24px' });",
  ])('rejects a physical side in a style file: %s', async (body) => {
    expect(await physicalSides(styleFile(body), STYLE_FILE)).toEqual([
      expect.objectContaining({ ruleId: 'no-restricted-syntax', severity: 2 }),
    ]);
  });

  it.each([
    'export const x = style({ marginInlineStart: a, paddingInlineEnd: b });',
    "export const x = style({ position: 'absolute', insetInlineStart: 0, insetInlineEnd: a });",
    'export const x = style({ borderInlineStart: a, borderStartEndRadius: b });',
    "export const x = style({ textAlign: 'start', float: 'inline-end' });",
    "export const x = style({ justifyContent: 'flex-end' });",
    'export const x = style({ paddingBlock: 0, paddingInline: `${a} ${b}` });',
    'export const x = style({ padding: `${a} ${b}` });',
    'export const x = style({ padding: `0 ${b} ${c}` });',
    'export const x = style({ padding: `${a} ${b} 0` });',
    "export const x = style({ padding: '0 8px 8px' });",
    "export const x = style({ padding: 'calc(0.1rem - 1px) calc(0.4rem - 1px)' });",
    'export const x = style({ inset: `calc(-1 * ${a})` });',
    "export const x = style({ paddingLeft: 'env(safe-area-inset-left, 0px)' });",
    "export const x = style({ paddingRight: withMargin('env(safe-area-inset-right, 0px)') });",
    "export const x = style({ paddingLeft: a ? 'env(safe-area-inset-left)' : 0 });",
    "export const x = style({ borderRadius: a, outlineOffset: '2px' });",
    "export const x = style({ borderRadius: '50%' });",
    "export const x = style({ borderRadius: '10px / 5px' });",
    'export const x = style({ borderRadius: `calc(${a} - 1px)` });',
    "export const x = style({ transformOrigin: 'center top', backgroundPosition: '50% 0' });",
    "export const x = style({ textAlign: 'start' as const });",
    'export const x = style({ paddingRight: `calc(env(safe-area-inset-right, 0px) + ${a})` });',
    // A variant named after a side is an object of styles, not a value of `left`.
    "export const x = { side: { left: { color: 'red' }, right: { color: 'blue' } } };",
    // Reading a computed style destructures; nothing is written.
    'export const read = (el: Element) => {\n  const { marginLeft } = getComputedStyle(el);\n  return marginLeft;\n};',
    '// eslint-disable-next-line no-restricted-syntax -- pinned to the physical edge on purpose\nexport const x = style({ right: a });',
  ])('allows logical sides and the documented exceptions: %s', async (body) => {
    expect(await physicalSides(styleFile(body), STYLE_FILE)).toEqual([]);
  });

  it.each([
    'export const X = () => <div style={{ right: 0 }} />;',
    'export const X = () => <div style={{ paddingLeft: 4 }} />;',
    'export const X = ({ on }: { on: boolean }) => <div style={on ? { left: 0 } : undefined} />;',
    "export const X = () => <div style={{ textAlign: 'right' }} />;",
    'export const X = () => <div style={{ padding: `0 ${8}px 0 ${16}px` }} />;',
    // A name only CSS uses counts outside a style prop too.
    "export const INSET = { paddingRight: '1.5rem' };",
    // Sides written onto an element's style at once.
    "export const place = (el: HTMLElement) => Object.assign(el.style, { left: '0px' });",
  ])('rejects a physical side in a component: %s', async (source) => {
    expect(await physicalSides(source, COMPONENT)).toEqual([
      expect.objectContaining({ ruleId: 'no-restricted-syntax', severity: 2 }),
    ]);
  });

  it.each([
    'export const X = () => <div style={{ insetInlineEnd: 0, paddingInlineStart: 4 }} />;',
    // Outside a style prop, left and right are coordinates or scroll offsets.
    "export const scroll = (el: Element) => el.scrollTo({ left: 10, behavior: 'smooth' });",
    'export const point = { left: 1, top: 2 };',
    "export const place = (el: HTMLElement) => Object.assign(el.style, { insetInlineStart: '0' });",
    'export const merge = (a: object) => Object.assign({}, a, { left: 1 });',
  ])('allows coordinates and logical styles in a component: %s', async (source) => {
    expect(await physicalSides(source, COMPONENT)).toEqual([]);
  });

  it('holds ported styles to the rule too', async () => {
    // A Lane P file (docs/provenance/portable.tsv).
    expect(
      await physicalSides(
        styleFile('export const x = style({ left: 0 });'),
        'src/app/ui/glass/Surface.css.ts'
      )
    ).toEqual([expect.objectContaining({ ruleId: 'no-restricted-syntax', severity: 2 })]);
  });

  it.each(['src/app/ui/Example.test.ts', 'src/app/ui/__tests__/Example.css.ts'])(
    'leaves tests alone: %s',
    async (filePath) => {
      expect(
        await physicalSides(styleFile('export const x = style({ left: 0 });'), filePath)
      ).toEqual([]);
    }
  );
});
