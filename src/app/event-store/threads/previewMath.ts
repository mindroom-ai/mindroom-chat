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
    'times × cdot ⋅ div ÷ pm ± mp ∓ circ ∘ le ≤ leq ≤ ge ≥ geq ≥ ne ≠ neq ≠ approx ≈ equiv ≡',
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
// Commands whose argument, without markup of its own, reads as written: text, upright letters, a box.
const PLAIN_COMMAND = /^(?:text|textrm|mathrm|mathit|boxed)$/;
// Commands that only size or tighten what they touch.
const SILENT_COMMAND = /^(?:left|right|[bB]igg?[lr]?|displaystyle|limits|nolimits|!)$/;
const SPACE_COMMAND = /^(?:[,:;> ]|quad|qquad)$/;
// Code that the renderer's tokenizer may not find the way Markdown does: a run of two or more
// backticks, a backtick after a backslash, a tilde fence or an indented line (in a block quote
// too), or HTML code; and the characters the formulas stand in as.
const UNCLEAR_CODE = /``|\\`|^[ >]*(?:~~~| {4}|\t)|<(?:code|pre)\b|[\uE000\uE001]/m;

/** A command, a space, one character, or the nodes of a braced group. */
type TexNode = string | TexNode[];

/** The nodes of `tex`, or `undefined` when its braces do not pair. */
const parseTex = (tex: string): TexNode[] | undefined => {
  const parents: TexNode[][] = [];
  let group: TexNode[] = [];
  for (const [token] of tex.matchAll(/\\(?:[A-Za-z]+|[\s\S]?)|\s+|[\s\S]/gu)) {
    if (token === '{') {
      const child: TexNode[] = [];
      group.push(child);
      parents.push(group);
      group = child;
    } else if (token === '}') {
      const parent = parents.pop();
      if (!parent) return undefined;
      group = parent;
    } else {
      group.push(/^\s/u.test(token) ? ' ' : token);
    }
  }
  return parents.length === 0 ? group : undefined;
};

const isCommand = (node: TexNode | undefined, pattern: RegExp): boolean =>
  typeof node === 'string' && node.startsWith('\\') && pattern.test(node.slice(1));

const hasMarkup = (node: TexNode | undefined): boolean =>
  Array.isArray(node) ? node.some(hasMarkup) : node === '^' || node === '_' || isCommand(node, /./);

// A part of more than one character keeps its extent in parentheses, unless it is a number.
const part = (text: string): string => {
  const trimmed = text.trim();
  return /^(?:.?|\d+(?:\.\d+)?)$/u.test(trimmed) ? trimmed : `(${trimmed})`;
};

/**
 * The formula as plain text, or `undefined` when any of it has no exact reading here: a command
 * other than those above, a missing argument, a script that is a lone sign, a root with an index,
 * a mixed number, a line break, a comment, braces that do not pair, or nothing to read. A fraction
 * always keeps parentheses (`(a/b)`), and so do a root's radicand (`√(x)`) and a bare script that
 * anything but a space, a sign, a closing bracket or another script follows (`x^(2)3`).
 */
const readFormula = (tex: string): string | undefined => {
  const tree = parseTex(tex);
  if (!tree) return undefined;
  let exact = true;
  const readNodes = (nodes: TexNode[]): string => {
    let index = 0;
    const skipSpace = () => {
      if (nodes[index] === ' ') index += 1;
    };
    // The next node after a space; reading past the end has no exact reading.
    const argument = (): string => {
      skipSpace();
      if (index >= nodes.length) exact = false;
      return read();
    };
    // The next node past sizing commands.
    const next = (): TexNode | undefined => {
      let at = index;
      while (isCommand(nodes[at], SILENT_COMMAND)) at += 1;
      return nodes[at];
    };
    // Whether a script may end before the next node: at the end, a space, a sign or a bracket.
    const endsScript = (): boolean => {
      const node = next();
      return (
        node === undefined ||
        node === ' ' ||
        (typeof node === 'string' && /^[-+=<>)\],;:|^_]$/.test(node)) ||
        isCommand(node, SPACE_COMMAND)
      );
    };
    // Whether a letter, digit, group or command follows, which would run into a function name.
    const joins = (): boolean => {
      const node = next();
      return (
        Array.isArray(node) ||
        (typeof node === 'string' && /^[\p{L}\p{N}]/u.test(node)) ||
        (isCommand(node, /./) && !isCommand(node, SPACE_COMMAND))
      );
    };
    // The next node, with the arguments of the command it names.
    const read = (): string => {
      const node = nodes[index++];
      if (node === undefined) return '';
      if (typeof node !== 'string') return readNodes(node);
      if (node === '^' || node === '_') {
        const bare = argument().trim();
        if (/^[!-/:-@[-`{-~]$/.test(bare)) exact = false;
        const script = part(bare);
        return node + (script === bare && !endsScript() ? `(${script})` : script);
      }
      if (node === '~') return ' ';
      if (node === '%') exact = false;
      if (!node.startsWith('\\')) return node;
      const name = node.slice(1);
      if (/^[dt]?frac$/.test(name)) {
        // After a number a fraction makes a mixed number (`3\frac{1}{4}`), which no reading fits.
        let at = index - 2;
        while (nodes[at] === ' ' || isCommand(nodes[at], SPACE_COMMAND)) at -= 1;
        const before = nodes[at];
        if (Array.isArray(before) || /^\d$/.test(before ?? '')) exact = false;
        const numerator = part(argument());
        return `(${numerator}/${part(argument())})`;
      }
      if (name === 'sqrt') {
        skipSpace();
        if (nodes[index] === '[') exact = false;
        return `√(${argument().trim()})`;
      }
      if (FUNCTION_NAME.test(name) || (name === 'operatorname' && Array.isArray(nodes[index]))) {
        // Spaces keep a function apart from its neighbours (`a\cos\theta` reads `a cos θ`).
        const before = nodes[index - 2];
        const word = name === 'operatorname' ? read() : name;
        const spaced = Array.isArray(before) || /^[\p{L}\p{N}\\]/u.test(before ?? '');
        return `${spaced ? ' ' : ''}${word}${joins() ? ' ' : ''}`;
      }
      if (PLAIN_COMMAND.test(name)) {
        skipSpace();
        if (hasMarkup(nodes[index])) exact = false;
        return argument();
      }
      if (SILENT_COMMAND.test(name)) {
        // `\left.` and `\right.` set no delimiter.
        if (name === 'left' || name === 'right') {
          skipSpace();
          if (nodes[index] === '.') index += 1;
        }
        return '';
      }
      if (SPACE_COMMAND.test(name)) return ' ';
      const symbol = SYMBOLS.get(name);
      if (symbol !== undefined) return symbol;
      if (!/^[{}%$#&_]$/.test(name)) exact = false;
      return name;
    };
    let text = '';
    while (index < nodes.length) text += read();
    return text;
  };
  const text = readNodes(tree);
  return exact && text.trim() ? text : undefined;
};

/**
 * `strip`, the Markdown stripping of a one-line preview, applied to `text`, with each formula that
 * messages typeset (`$…$`, `$$…$$`) read as plain text where its reading is exact: the preview
 * shows `(a/b)` rather than `$\frac{a}{b}$`. Symbols and function names read as themselves, text
 * and sizes lose their commands, `^` and `_` stay, and parentheses keep each part of a fraction,
 * root or script together. Any other formula stays as written, and so does every formula of a body
 * whose code the tokenizer may not find: it finds a span between two single backticks, so a body
 * with other code, or with an odd number of backticks, keeps its formulas as written. Formulas
 * stand in as placeholders while `strip` runs, so its Markdown rules never change them. The
 * tokenizer also scans for links, several times the cost of the rest of a preview, so only text
 * that holds a formula goes through it.
 */
export const stripPreviewMath = (text: string, strip: (text: string) => string): string => {
  if (
    !text.includes('$') ||
    UNCLEAR_CODE.test(text) ||
    (text.match(/`/g) ?? []).length % 2 === 1 ||
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
