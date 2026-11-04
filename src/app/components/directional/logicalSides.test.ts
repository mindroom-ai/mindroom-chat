import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The ESLint rule of .eslintrc.cjs that keeps physical sides (left, right) out of Lane C styles,
// so the interface mirrors in right-to-left languages. Made-up paths get the rule by pattern.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../../', import.meta.url)) });
const STYLE_FILE = 'src/app/components/directional/Example.css.ts';
const COMPONENT = 'src/app/components/directional/Example.tsx';

const physicalSides = async (source: string, filePath: string) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result?.fatalErrorCount).toBe(0);
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax');
};

const styleFile = (body: string) =>
  `import { globalStyle, style } from '@vanilla-extract/css';\n\nconst a = '1px';\nconst b = '2px';\nconst c = '3px';\nconst d = '4px';\nconst withMargin = (inset: string) => \`calc(\${inset} + 4px)\`;\n${body}\n`;

describe('logical sides in Lane C styles', () => {
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
  ])('allows coordinates and logical styles in a component: %s', async (source) => {
    expect(await physicalSides(source, COMPONENT)).toEqual([]);
  });

  it.each([
    // Lane P keeps its ported styles.
    'src/app/components/glass/Surface.css.ts',
    'src/app/components/directional/Example.test.ts',
    'src/app/components/directional/__tests__/Example.css.ts',
  ])('leaves ported styles and tests alone: %s', async (filePath) => {
    expect(
      await physicalSides(styleFile('export const x = style({ left: 0 });'), filePath)
    ).toEqual([]);
  });
});
