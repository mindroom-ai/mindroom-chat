import { tokenizeTextWithLatex } from '../../rich-text/math';

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
    'vert | lvert | rvert | prime ′',
  ]
    .join(' ')
    .split(' ')
    .flatMap((word, index, words): [string, string][] =>
      index % 2 === 0 ? [[word, words[index + 1] ?? '']] : []
    )
);
// Commands that only style their argument, which reads as written.
const STYLE_COMMAND =
  /^(?:text(?:rm|bf|it|sf|tt)?|math(?:rm|bf|it|sf|tt|bb|cal|frak)|operatorname|boldsymbol|boxed|hat|bar|vec|dot|tilde|overline|underline)$/;
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

const readTex = (nodes: TexNode[]): string => {
  let index = 0;
  // The next node, with the arguments of the command it names.
  const read = (): string => {
    const node = nodes[index++];
    if (node === undefined) return '';
    if (typeof node !== 'string') return readTex(node);
    if (node === '^' || node === '_') return node + part(argument());
    if (node === '&' || node === '~') return ' ';
    if (!node.startsWith('\\')) return node;
    const name = node.slice(1);
    if (/^[dt]?frac$/.test(name)) {
      const numerator = part(argument());
      return `${numerator}/${part(argument())}`;
    }
    if (name === 'sqrt') return `√${part(argument())}`;
    if (name === 'begin' || name === 'end') {
      argument();
      return '';
    }
    if (name === '\\') return '; ';
    if (STYLE_COMMAND.test(name)) return argument();
    if (SILENT_COMMAND.test(name)) return '';
    if (SPACE_COMMAND.test(name)) return ' ';
    const symbol = SYMBOLS.get(name);
    if (symbol !== undefined || !/^[A-Za-z]/.test(name)) return symbol ?? name;
    // Any other command reads as its name, with its braced arguments in parentheses.
    const args: string[] = [];
    while (Array.isArray(nodes[index]) || (nodes[index] === ' ' && Array.isArray(nodes[index + 1])))
      args.push(argument());
    return args.length > 0 ? `${name}(${args.join(', ')})` : name;
  };
  // The next node after a space.
  const argument = (): string => {
    if (nodes[index] === ' ') index += 1;
    return read();
  };
  let text = '';
  while (index < nodes.length) {
    const piece = read();
    // A row break (`\\`) ends its row without the space before it.
    text = piece === '; ' ? `${text.trimEnd()}; ` : text + piece;
  }
  return text;
};

/**
 * `text` with each formula that messages typeset (`$…$`, `$$…$$`) read as plain text, so a one-line
 * preview shows `a/b` rather than `$\frac{a}{b}$`. Symbols become their characters, styling goes,
 * `^` and `_` stay, and a fraction, root or script of more than one character keeps parentheses.
 */
export const stripPreviewMath = (text: string): string =>
  text.includes('$')
    ? tokenizeTextWithLatex(text)
        .map((segment) =>
          segment.type === 'math' ? readTex(parseTex(segment.content)) : segment.content
        )
        .join('')
    : text;
