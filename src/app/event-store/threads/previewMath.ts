import {
  findDisplayLatexBlockMatch,
  findInlineLatexMatch,
  tokenizeTextWithLatex,
} from '../../rich-text/math';

// The commands that stand for one character, as `name character` pairs.
const SYMBOLS = new Map(
  [
    'alpha α beta β gamma γ delta δ epsilon ε varepsilon ε zeta ζ eta η theta θ iota ι kappa κ',
    'lambda λ mu μ nu ν xi ξ pi π rho ρ sigma σ tau τ upsilon υ phi φ varphi φ chi χ psi ψ omega ω',
    'Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω',
    'times × cdot · div ÷ pm ± mp ∓ circ ∘ le ≤ leq ≤ ge ≥ geq ≥ ne ≠ neq ≠ approx ≈ equiv ≡',
    'sim ∼ propto ∝ to → rightarrow → leftarrow ← Rightarrow ⇒ Leftarrow ⇐ leftrightarrow ↔',
    'Leftrightarrow ⇔ implies ⇒ iff ⇔ mapsto ↦ in ∈ notin ∉ subset ⊂ subseteq ⊆ cup ∪ cap ∩',
    'emptyset ∅ forall ∀ exists ∃ neg ¬ land ∧ lor ∨ infty ∞ partial ∂ nabla ∇ sum ∑ prod ∏',
    'int ∫ ldots … cdots ⋯ dots … langle ⟨ rangle ⟩ lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ mid |',
    'vert | lvert | rvert | Vert ‖ lVert ‖ rVert ‖ | ‖ prime ′',
  ]
    .join(' ')
    .split(' ')
    .flatMap((word, index, words): [string, string][] =>
      index % 2 === 0 ? [[word, words[index + 1] ?? '']] : []
    )
);
// Commands that only set the font of their argument, which reads as written.
const FONT_COMMAND =
  /^(?:text(?:rm|bf|it|sf|tt)?|math(?:rm|bf|it|sf|tt|bb|cal|frak)|operatorname|boldsymbol|boxed)$/;
// Commands that only size or tighten what they touch.
const SILENT_COMMAND = /^(?:left|right|[bB]igg?[lr]?|displaystyle|limits|nolimits|!)$/;
const SPACE_COMMAND = /^(?:[,:;> ]|quad|qquad)$/;

/** A command, a space, one character, or the nodes of a braced group. */
type TexNode = string | TexNode[];

const parseTex = (tex: string): TexNode[] => {
  const parents: TexNode[][] = [];
  let group: TexNode[] = [];
  for (const [token] of tex.matchAll(/\\(?:[A-Za-z]+|[\s\S]?)|\s+|[\s\S]/gu)) {
    if (token === '{') {
      const child: TexNode[] = [];
      group.push(child);
      parents.push(group);
      group = child;
    } else if (token === '}') {
      group = parents.pop() ?? group;
    } else {
      group.push(/^\s/u.test(token) ? ' ' : token);
    }
  }
  return parents[0] ?? group;
};

// A part of more than one character keeps its extent in parentheses, unless it is a number.
const part = (text: string): string => {
  const trimmed = text.trim();
  return /^(?:.?|\d+(?:[.,]\d+)?)$/u.test(trimmed) ? trimmed : `(${trimmed})`;
};

/**
 * The formula as plain text, or `undefined` when it holds what the reader does not know: a command
 * with braced arguments other than a fraction, root or font (an accent, `\binom`, an environment),
 * a root with an index, a line break, or nothing to read.
 */
const readFormula = (tex: string): string | undefined => {
  let known = true;
  const readNodes = (nodes: TexNode[]): string => {
    let index = 0;
    // The next node after a space.
    const argument = (): string => {
      if (nodes[index] === ' ') index += 1;
      return read();
    };
    // A fraction or root keeps parentheses when a script, letter, digit, group or command joins it.
    const whole = (text: string): string => {
      const next = nodes[index];
      const joined =
        Array.isArray(next) ||
        (typeof next === 'string' &&
          (/^[\^_\p{L}\p{N}]$/u.test(next) ||
            (next.startsWith('\\') &&
              !SILENT_COMMAND.test(next.slice(1)) &&
              !SPACE_COMMAND.test(next.slice(1)))));
      return joined ? `(${text})` : text;
    };
    // The next node, with the arguments of the command it names.
    const read = (): string => {
      const node = nodes[index++];
      if (node === undefined) return '';
      if (typeof node !== 'string') return readNodes(node);
      if (node === '^' || node === '_') return node + part(argument());
      if (node === '~') return ' ';
      if (!node.startsWith('\\')) return node;
      const name = node.slice(1);
      if (/^[dt]?frac$/.test(name)) {
        const numerator = part(argument());
        return whole(`${numerator}/${part(argument())}`);
      }
      if (name === 'sqrt' && nodes[index] !== '[') return whole(`√${part(argument())}`);
      if (FONT_COMMAND.test(name)) return argument();
      if (SILENT_COMMAND.test(name)) return '';
      if (SPACE_COMMAND.test(name)) return ' ';
      const symbol = SYMBOLS.get(name);
      if (symbol !== undefined) return symbol;
      // Any other command reads as its name (`\sin`, `\%`), unless it takes braced arguments.
      const takesArguments =
        Array.isArray(nodes[index]) || (nodes[index] === ' ' && Array.isArray(nodes[index + 1]));
      if (name === 'sqrt' || name === '\\' || (/^[A-Za-z]/.test(name) && takesArguments)) {
        known = false;
      }
      return name;
    };
    let text = '';
    while (index < nodes.length) text += read();
    return text;
  };
  const text = readNodes(parseTex(tex));
  return known && text.trim() ? text : undefined;
};

/**
 * `strip`, the Markdown stripping of a one-line preview, applied to `text`, with each formula that
 * messages typeset (`$…$`, `$$…$$`) read as plain text: the preview shows `a/b` rather than
 * `$\frac{a}{b}$`. Symbols become their characters, fonts and sizes go, `^` and `_` stay, a part of
 * a fraction, root or script that is longer than one character keeps parentheses unless it is a
 * number, and so does a fraction or root that something joins. A formula with anything else stays as
 * written. Formulas stand in as placeholders while `strip` runs, so its Markdown rules never change
 * them. The tokenizer also scans for links, several times the cost of the rest of a preview, so only
 * text that holds a formula goes through it.
 */
export const stripPreviewMath = (text: string, strip: (text: string) => string): string => {
  if (!text.includes('$') || !(findInlineLatexMatch(text) ?? findDisplayLatexBlockMatch(text))) {
    return strip(text);
  }
  const formulas: string[] = [];
  const marked = tokenizeTextWithLatex(text)
    .map((segment) => {
      if (segment.type !== 'math') return segment.content;
      const { content, displayMode } = segment;
      formulas.push(readFormula(content) ?? (displayMode ? `$$\n${content}\n$$` : `$${content}$`));
      return `\uE000${formulas.length - 1}\uE001`;
    })
    .join('');
  return strip(marked).replace(
    /\uE000(\d+)\uE001/g,
    (placeholder, at: string) => formulas[Number(at)] ?? placeholder
  );
};
