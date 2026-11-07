import { describe, expect, it } from 'vitest';
import { getThreadMessagePreviewText } from './threadMessagePreview';
import backendBodies from '../../messages/__fixtures__/backendToolMarkerBodies.json';

const preview = (body: string) => getThreadMessagePreviewText({ msgtype: 'm.text', body });

describe('thread previews of math', () => {
  it('read a formula as plain text instead of its TeX source', () => {
    expect(preview('The ratio is $\\frac{a}{b}$.')).toBe('The ratio is a/b.');
  });

  it('read the inline and display math of an agent answer', () => {
    expect(
      preview(
        'The roots of $ax^2 + bx + c = 0$ are\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n\nwhenever $a \\neq 0$.'
      )
    ).toBe('The roots of ax^2 + bx + c = 0 are x = (-b ± √(b^2 - 4ac))/(2a) whenever a ≠ 0.');
  });

  it('read the math of a body the backend formatted around a tool call', () => {
    expect(preview(backendBodies['LaTeX around a tool call'].body)).toBe(
      '🔧 1 tool · E = mc^2 Inline x^2 stays.'
    );
  });

  it('read symbols, fonts and scripts', () => {
    expect(preview('$e^{i\\pi} + 1 = 0$')).toBe('e^(iπ) + 1 = 0');
    expect(preview('$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$')).toBe('∑_(i=1)^n i = (n(n+1))/2');
    expect(preview('$\\text{speed} = \\dfrac{\\text{distance}}{\\mathrm{time}}$')).toBe(
      'speed = (distance)/(time)'
    );
    expect(preview('So $P(A \\mid B) \\approx 0.3$.')).toBe('So P(A | B) ≈ 0.3.');
    expect(preview('$\\|x\\|_2 \\leq |y|$')).toBe('‖x‖_2 ≤ |y|');
  });

  it('keep a fraction or root whole where a script, letter or command joins it', () => {
    expect(preview('$\\frac{2}{3}^{2} = \\frac{4}{9}$')).toBe('(2/3)^2 = 4/9');
    expect(preview('$E_k = \\frac{1}{2}mv^2$')).toBe('E_k = (1/2)mv^2');
    expect(preview('$\\sqrt{x}^2 + \\left(\\frac{a}{b}\\right)^2 + \\frac{1}{n}\\sum x$')).toBe(
      '(√x)^2 + (a/b)^2 + (1/n)∑ x'
    );
  });

  it('read sizing, spacing, escaped characters and unbalanced braces', () => {
    expect(preview('$\\left( \\frac {1}  {x+1} \\right)^{10}\\,\\text{and}~\\sin x$')).toBe(
      '( 1/(x+1) )^10 and sin x'
    );
    expect(preview('$50\\%$ of $\\{1, 2\\}$')).toBe('50% of {1, 2}');
    expect(preview('$\\frac{1}{2$ and $a}b$ and $x^$')).toBe('1/2 and ab and x^');
  });

  it('keep a formula as written when the reader does not know all of it', () => {
    expect(preview('$\\bar{x} \\neq x$ and $\\binom {5}{2} = 10$')).toBe(
      '$\\bar{x} \\neq x$ and $\\binom {5}{2} = 10$'
    );
    expect(preview('$\\sqrt[3]{8} = 2$, $a \\\\ b$ and ${}$')).toBe(
      '$\\sqrt[3]{8} = 2$, $a \\\\ b$ and ${}$'
    );
    expect(preview('$$\n\\begin{vmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{vmatrix} = -2\n$$')).toBe(
      '$$ \\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix} = -2 $$'
    );
  });

  it('keep Markdown rules away from a formula', () => {
    expect(preview('$- x$ is negative\n$|x|$\n$> 0$')).toBe('- x is negative |x| > 0');
  });

  it('leave prices, code and text without math as written', () => {
    expect(preview('It costs $5 and $10 per seat.')).toBe('It costs $5 and $10 per seat.');
    expect(preview('Run `echo $HOME` or `$\\frac{a}{b}$` here.')).toBe(
      'Run echo $HOME or $\\frac{a}{b}$ here.'
    );
    expect(preview('Plain text stays plain.')).toBe('Plain text stays plain.');
  });
});
