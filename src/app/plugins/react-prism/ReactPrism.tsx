import React, { ReactNode, useMemo } from 'react';
import classNames from 'classnames';
// Prism must not highlight the page by itself, so manual mode is set before it loads.
import './prismManual';
import Prism from 'prismjs';
// Languages, each after the ones it builds on. Prism's core has markup, CSS, C-like and JavaScript.
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-shell-session';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-nix';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-elixir';

/** Prism's grammar for a language name or alias, such as `ts` or `sh`. */
export const getPrismGrammar = (language: string | undefined): Prism.Grammar | undefined => {
  if (!language) return undefined;
  const name = language.toLowerCase();
  return Object.prototype.hasOwnProperty.call(Prism.languages, name)
    ? (Prism.languages[name] as Prism.Grammar)
    : undefined;
};

const renderTokens = (stream: Prism.TokenStream, key: string): ReactNode => {
  if (typeof stream === 'string') return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) => renderTokens(token, `${key}.${index}`));
  }
  const aliases = Array.isArray(stream.alias) ? stream.alias : [stream.alias];
  return (
    <span key={key} className={classNames('token', stream.type, aliases)}>
      {renderTokens(stream.content, key)}
    </span>
  );
};

type PrismCodeProps = {
  code: string;
  language?: string;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * Code with Prism's syntax colors, as `<code>` holding Prism's token spans (`token keyword`, ...).
 * React renders the tokens itself, so a streamed edit never shows uncolored code and Prism never
 * changes elements React owns. Code in a language Prism does not know is shown as text.
 */
export function PrismCode({ code, language, id, className, style }: PrismCodeProps) {
  const grammar = getPrismGrammar(language);
  const content = useMemo(
    () => (grammar ? renderTokens(Prism.tokenize(code, grammar), 'token') : code),
    [code, grammar]
  );
  return (
    <code
      id={id}
      className={classNames(className, language && `language-${language}`)}
      style={style}
    >
      {content}
    </code>
  );
}
