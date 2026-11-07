import { describe, expect, it } from 'vitest';
import { getThreadMessagePreviewText } from './threadMessagePreview';
import backendBodies from '../../messages/__fixtures__/backendToolMarkerBodies.json';

const preview = (body: string) => getThreadMessagePreviewText({ msgtype: 'm.text', body });

describe('thread previews of math', () => {
  it('read a formula as plain text instead of its TeX source', () => {
    expect(preview('The ratio is $\\frac{a}{b}$.')).toBe('The ratio is (a/b).');
  });

  it('read the inline and display math of an agent answer', () => {
    expect(
      preview(
        'The roots of $ax^2 + bx + c = 0$ are\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n\nwhenever $a \\neq 0$.'
      )
    ).toBe('The roots of ax^2 + bx + c = 0 are x = ((-b ± √(b^2 - 4ac))/(2a)) whenever a ≠ 0.');
  });

  it('read the math of a body the backend formatted around a tool call', () => {
    expect(preview(backendBodies['LaTeX around a tool call'].body)).toBe(
      '🔧 1 tool · E = mc^2 Inline x^2 stays.'
    );
  });

  it('read symbols, functions, text and scripts', () => {
    expect(preview('$e^{i\\pi} + 1 = 0$')).toBe('e^(iπ) + 1 = 0');
    expect(preview('$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$')).toBe('∑_(i=1)^n i = ((n(n+1))/2)');
    expect(preview('$\\text{speed} = \\dfrac{\\text{distance}}{\\mathrm{time}}$')).toBe(
      'speed = ((distance)/(time))'
    );
    expect(preview('So $P(A \\mid B) \\approx 0.3$ and $\\phi \\ne \\varphi$.')).toBe(
      'So P(A | B) ≈ 0.3 and ϕ ≠ φ.'
    );
    expect(preview('$\\|x\\|_2 \\leq |y|$ and $a\\cos\\theta + \\sin(x)$')).toBe(
      '‖x‖_2 ≤ |y| and a cos θ + sin(x)'
    );
    expect(preview('$x\\operatorname{sgn}(x) + \\operatorname{tr}A$')).toBe('x sgn(x) + tr A');
    expect(preview('$a \\cdot b$ for $x_1, x_2 \\in S$')).toBe('a ⋅ b for x_1, x_2 ∈ S');
  });

  it('keep the parts of fractions, roots and scripts together', () => {
    expect(preview('$\\frac{2}{3}^{2} = \\frac{4}{9}$ and $\\frac{2}{3} ^2$')).toBe(
      '(2/3)^2 = (4/9) and (2/3) ^2'
    );
    expect(preview('$E_k = \\frac{1}{2}mv^2$ and $1/\\frac{1}{2}$')).toBe(
      'E_k = (1/2)mv^2 and 1/(1/2)'
    );
    expect(preview('$\\sqrt{x}^2 + x^{2}2^{x} + \\frac{1}{n}\\sum x$')).toBe(
      '√(x)^2 + x^(2)2^x + (1/n)∑ x'
    );
    expect(preview('$x_1x_2 + 2^n{x} + a_{1,2} + \\left(x^2\\right)$')).toBe(
      'x_(1)x_2 + 2^(n)x + a_(1,2) + (x^2)'
    );
    expect(preview('$\\log_{10}1000 + 2^{10}x + x^2\\!3 + e^x(1+x)$')).toBe(
      'log_(10)1000 + 2^(10)x + x^(2)3 + e^(x)(1+x)'
    );
    expect(preview('$\\left.2x\\right|_0^1 = 2$ and $x^{2}.5$')).toBe('2x|_0^1 = 2 and x^(2).5');
  });

  it('read sizing, spacing and escaped characters', () => {
    expect(preview('$\\left( \\frac {1}  {x+1} \\right)^{10}\\,\\text{and}~\\sin x$')).toBe(
      '( (1/(x+1)) )^10 and sin x'
    );
    expect(preview('$50\\%$ of $\\{1, 2\\}$')).toBe('50% of {1, 2}');
    expect(preview('$\\displaystyle.5 + \\left .x\\right.$')).toBe('.5 + x');
  });

  it('keep a formula as written when the reader does not know all of it', () => {
    expect(preview('$\\bar{x} \\neq x$ and $\\binom {5}{2} = 10$ and $\\mathcal{F} \\ne F$')).toBe(
      '$\\bar{x} \\neq x$ and $\\binom {5}{2} = 10$ and $\\mathcal{F} \\ne F$'
    );
    expect(preview('$\\sqrt [3]{8} = 2$, $\\vec F$, $a \\\\ b$ and ${}$')).toBe(
      '$\\sqrt [3]{8} = 2$, $\\vec F$, $a \\\\ b$ and ${}$'
    );
    expect(preview('$\\operatorname*{arg\\,max}_x f$')).toBe('$\\operatorname*{arg\\,max}_x f$');
    expect(preview('$3\\frac{1}{4}$, $\\frac{1}{2$, $a}b$ and $x % note$')).toBe(
      '$3\\frac{1}{4}$, $\\frac{1}{2$, $a}b$ and $x % note$'
    );
    expect(preview('$3 \\frac{1}{4}$, $2\\,\\tfrac{3}{4}$, ${3}\\frac{1}{4}$ and $2^(n-1)$')).toBe(
      '$3 \\frac{1}{4}$, $2\\,\\tfrac{3}{4}$, ${3}\\frac{1}{4}$ and $2^(n-1)$'
    );
    expect(preview('$x^$, $\\frac{a}$, $\\text{snake_case}$ and $\\textbf{v}$')).toBe(
      '$x^$, $\\frac{a}$, $\\text{snake_case}$ and $\\textbf{v}$'
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

  it('keep every formula of a body with code the tokenizer cannot find as written', () => {
    expect(preview('See ``$\\frac{a}{b}$`` and $x^2$.')).toBe('See `$\\frac{a}{b}$` and $x^2$.');
    expect(preview('~~~\n$\\frac{a}{b}$\n~~~\nand $x^2$')).toBe('$\\frac{a}{b}$ and $x^2$');
    expect(preview('````\n```\n$\\frac{a}{b}$\n```\n````\nand $x^2$')).toBe(
      '``` $\\frac{a}{b}$ ``` and $x^2$'
    );
    expect(preview('Example:\n\n    $\\frac{a}{b}$\n\nand $x^2$')).toBe(
      'Example: $\\frac{a}{b}$ and $x^2$'
    );
    expect(preview('> ~~~\n> $\\frac{a}{b}$\n> ~~~\n\nand $x^2$')).toBe('$\\frac{a}{b}$ and $x^2$');
    expect(preview('<code>$\\frac{a}{b}$</code> and $x^2$')).toBe(
      '<code>$\\frac{a}{b}$</code> and $x^2$'
    );
    expect(preview('A backslash (`\\`) starts `$\\frac{a}{b}$`, shown as $\\frac{a}{b}$.')).toBe(
      'A backslash (\\) starts $\\frac{a}{b}$, shown as $\\frac{a}{b}$.'
    );
    expect(preview('```markdown\n```latex\n$\\frac{1}{2}$\n```\n```')).toBe(
      '```latex $\\frac{1}{2}$'
    );
    expect(preview('Press ` then $x^2$')).toBe('Press ` then $x^2$');
    expect(preview('\uE0000\uE001 and $x^2$')).toBe('\uE0000\uE001 and $x^2$');
  });
});
