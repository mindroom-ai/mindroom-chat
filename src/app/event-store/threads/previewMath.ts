import {
  findDisplayLatexBlockMatch,
  findInlineLatexMatch,
  tokenizeTextWithLatex,
} from '../../rich-text/math';

// The commands that stand for one character, as `name character` pairs.
const SYMBOLS = new Map(
  [
    'alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι',
    'kappa κ lambda λ mu μ nu ν xi ξ pi π rho ρ sigma σ tau τ upsilon υ phi ϕ varphi φ chi χ',
    'psi ψ omega ω Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω',
    'times × cdot · div ÷ pm ± mp ∓ circ ∘ le ≤ leq ≤ ge ≥ geq ≥ ne ≠ neq ≠ approx ≈ equiv ≡',
    'sim ∼ propto ∝ to → rightarrow → leftarrow ← Rightarrow ⇒ Leftarrow ⇐ leftrightarrow ↔',
    'Leftrightarrow ⇔ implies ⇒ iff ⇔ mapsto ↦ in ∈ notin ∉ subset ⊂ subseteq ⊆ cup ∪ cap ∩',
    'emptyset ∅ forall ∀ exists ∃ neg ¬ land ∧ lor ∨ infty ∞ partial ∂ nabla ∇ sum ∑ prod ∏',
    'int ∫ ldots … cdots ⋯ dots … langle ⟨ rangle ⟩ lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ mid |',
    'vert | lvert | rvert | Vert ‖ lVert ‖ rVert ‖ | ‖ prime ′ ell ℓ hbar ℏ',
  ]
    .join(' ')
    .split(' ')
    .flatMap((word, index, words): [string, string][] =>
      index % 2 === 0 ? [[word, words[index + 1] ?? '']] : []
    )
);
// Function names, which read as themselves.
const FUNCTION_NAME =
  /^(?:(?:arc)?(?:sin|cos|tan|cot|sec|csc)h?|log|ln|lg|exp|lim|max|min|sup|inf|det|gcd|deg|dim|arg|ker|Pr)$/;
// Commands whose braced argument reads as written: text, upright letters, a name, a box.
const PLAIN_COMMAND = /^(?:text(?:rm|it|bf)?|mathrm|mathit|operatorname|boxed)$/;
// Commands that only size or tighten what they touch.
const SILENT_COMMAND = /^(?:left|right|[bB]igg?[lr]?|displaystyle|limits|nolimits|!)$/;
const SPACE_COMMAND = /^(?:[,:;> ]|quad|qquad)$/;
// Code that the renderer's tokenizer cannot tell from text in a Markdown body: a run of two or of
// four and more backticks, a tilde fence, or a line indented like code.
const UNSEEN_CODE = /(?<!`)``(?!`)|````|^ {0,3}~~~|^(?: {4}|\t)/m;

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
  return /^(?:.?|\d+(?:\.\d+)?)$/u.test(trimmed) ? trimmed : `(${trimmed})`;
};

/**
 * The formula as plain text, or `undefined` when any of it has no exact reading here: a command
 * other than those above, a fraction and a root, a root with an index, a line break, or nothing to
 * read. A fraction always keeps parentheses (`(a/b)`), and so does a root's radicand (`√(x)`).
 */
const readFormula = (tex: string): string | undefined => {
  let exact = true;
  const readNodes = (nodes: TexNode[]): string => {
    let index = 0;
    const skipSpace = () => {
      if (nodes[index] === ' ') index += 1;
    };
    // The next node after a space.
    const argument = (): string => {
      skipSpace();
      return read();
    };
    // Whether what comes next would run into the text before it: a letter, digit, group or command.
    const joins = (): boolean => {
      const next = nodes[index];
      if (typeof next !== 'string') return next !== undefined;
      const name = next.startsWith('\\') ? next.slice(1) : '';
      return (
        /^[\p{L}\p{N}]/u.test(next) ||
        (name !== '' && !SILENT_COMMAND.test(name) && !SPACE_COMMAND.test(name))
      );
    };
    // The next node, with the arguments of the command it names.
    const read = (): string => {
      const node = nodes[index++];
      if (node === undefined) return '';
      if (typeof node !== 'string') return readNodes(node);
      if (node === '^' || node === '_') {
        const script = part(argument());
        return node + ([...script].length === 1 && joins() ? `(${script})` : script);
      }
      if (node === '~') return ' ';
      if (!node.startsWith('\\')) return node;
      const name = node.slice(1);
      if (/^[dt]?frac$/.test(name)) {
        const numerator = part(argument());
        return `(${numerator}/${part(argument())})`;
      }
      if (name === 'sqrt') {
        skipSpace();
        if (nodes[index] === '[') exact = false;
        return `√(${read().trim()})`;
      }
      if (PLAIN_COMMAND.test(name) && Array.isArray(nodes[index])) return read();
      if (SILENT_COMMAND.test(name)) return '';
      if (SPACE_COMMAND.test(name)) return ' ';
      const symbol = SYMBOLS.get(name);
      if (symbol !== undefined) return symbol;
      if (FUNCTION_NAME.test(name)) {
        // A space keeps a function apart from a factor before it (`a\cos` reads `a cos`, not `acos`).
        const before = nodes[index - 2];
        const spaced = Array.isArray(before) || /^[\p{L}\p{N}\\]/u.test(before ?? '');
        return `${spaced ? ' ' : ''}${name}${joins() ? ' ' : ''}`;
      }
      if (!/^[{}%$#&_]$/.test(name)) exact = false;
      return name;
    };
    let text = '';
    while (index < nodes.length) text += read();
    return text;
  };
  const text = readNodes(parseTex(tex));
  return exact && text.trim() ? text : undefined;
};

/**
 * `strip`, the Markdown stripping of a one-line preview, applied to `text`, with each formula that
 * messages typeset (`$…$`, `$$…$$`) read as plain text where its reading is exact: the preview
 * shows `(a/b)` rather than `$\frac{a}{b}$`. Symbols and function names read as themselves, text
 * and sizes lose their commands, `^` and `_` stay, and parentheses keep each part of a fraction,
 * root or script together. Any other formula stays as written, and so does every formula of a body
 * with code the tokenizer cannot find. Formulas stand in as placeholders while `strip` runs, so its
 * Markdown rules never change them. The tokenizer also scans for links, several times the cost of
 * the rest of a preview, so only text that holds a formula goes through it.
 */
export const stripPreviewMath = (text: string, strip: (text: string) => string): string => {
  if (
    !text.includes('$') ||
    UNSEEN_CODE.test(text) ||
    !(findInlineLatexMatch(text) ?? findDisplayLatexBlockMatch(text))
  ) {
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
