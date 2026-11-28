import { FALLBACK_MIMETYPE, getFileNameExt, getMimeTypeBase } from '../../lib/mimeTypes';

// Match the grammars bundled in ReactPrism.tsx, plus common files best shown as plain text.
const LANGUAGE_BY_EXTENSION = new Map(
  Object.entries({
    html: 'html htm xhtml',
    xml: 'xml svg xsl xslt xsd rss atom mathml ssml',
    css: 'css',
    javascript: 'js mjs cjs',
    jsx: 'jsx',
    typescript: 'ts mts cts',
    tsx: 'tsx',
    json: 'json jsonc jsonl ndjson',
    yaml: 'yaml yml',
    toml: 'toml',
    ini: 'ini',
    bash: 'sh bash zsh ksh',
    'shell-session': 'shell-session sh-session shellsession console',
    powershell: 'ps1 psm1 psd1',
    python: 'py pyi pyw',
    markdown: 'md markdown',
    diff: 'diff patch',
    docker: 'dockerfile containerfile',
    makefile: 'mk mak make makefile',
    nix: 'nix',
    sql: 'sql',
    graphql: 'graphql gql graphqls',
    scss: 'scss',
    c: 'c h',
    cpp: 'cpp cc cxx c++ hpp hh hxx h++',
    csharp: 'cs csx',
    java: 'java',
    kotlin: 'kt kts',
    swift: 'swift',
    go: 'go',
    rust: 'rs',
    ruby: 'rb rake gemspec',
    php: 'php phtml',
    lua: 'lua',
    r: 'r',
    haskell: 'hs lhs',
    elixir: 'ex exs',
    plaintext: 'txt text log csv tsv env gitignore dockerignore rst cfg conf properties',
  }).flatMap(([language, extensions]) =>
    extensions.split(' ').map((extension) => [extension, language] as const)
  )
);

const LANGUAGE_BY_FILENAME = new Map([
  ['makefile', 'makefile'],
  ['gnumakefile', 'makefile'],
  ['bsdmakefile', 'makefile'],
  ['makefile.am', 'makefile'],
  ['makefile.in', 'makefile'],
  ['dockerfile', 'docker'],
  ['containerfile', 'docker'],
  ['gemfile', 'ruby'],
  ['rakefile', 'ruby'],
  ['.bashrc', 'bash'],
  ['.bash_profile', 'bash'],
  ['.profile', 'bash'],
  ['.zshrc', 'bash'],
  ['.zprofile', 'bash'],
  ['.editorconfig', 'ini'],
  ['.gitconfig', 'ini'],
  ['.gitmodules', 'ini'],
  ['.npmrc', 'ini'],
  ['.env', 'plaintext'],
  ['.gitignore', 'plaintext'],
  ['.dockerignore', 'plaintext'],
  ['.gitattributes', 'plaintext'],
  ['readme', 'plaintext'],
  ['license', 'plaintext'],
  ['changelog', 'plaintext'],
]);

const LANGUAGE_BY_TEXT_MIME_TYPE = new Map([
  ['application/json', 'json'],
  ['application/ld+json', 'json'],
  ['application/xml', 'xml'],
  ['application/x-yaml', 'yaml'],
  ['application/yaml', 'yaml'],
  ['application/javascript', 'javascript'],
  ['application/x-javascript', 'javascript'],
  ['application/typescript', 'typescript'],
  // These types were already previewable without a MIME-only highlighting language.
  ['application/x-sh', 'plaintext'],
  ['application/toml', 'plaintext'],
  ['application/sql', 'sql'],
  ['application/x-diff', 'diff'],
  ['application/x-patch', 'diff'],
  ['application/graphql', 'graphql'],
  // SVG is eligible only for the escaped source viewer, never for media rendering.
  ['image/svg+xml', 'xml'],
  ['text/css', 'css'],
  ['text/html', 'html'],
  ['text/diff', 'diff'],
  ['text/x-diff', 'diff'],
  ['text/patch', 'diff'],
  ['text/x-patch', 'diff'],
  ['text/graphql', 'graphql'],
]);

const FILENAME_FALLBACK_MIME_TYPES = new Set([
  '',
  FALLBACK_MIMETYPE,
  'application/unknown',
  // Some systems use this MIME type for Rust's .rs extension.
  'application/rls-services+xml',
]);

const MIME_LANGUAGE_SUFFIXES = ['json', 'xml', 'yaml', 'javascript', 'typescript', 'sql', 'python'];

const getBaseMimeType = (mimeType: unknown): string =>
  typeof mimeType === 'string' ? getMimeTypeBase(mimeType) : '';

const getFileNameLanguage = (fileName: unknown): string | undefined => {
  if (typeof fileName !== 'string') return undefined;
  const name = fileName.toLowerCase();
  const language =
    LANGUAGE_BY_FILENAME.get(name) ?? LANGUAGE_BY_EXTENSION.get(getFileNameExt(name));
  if (language) return language;
  if (name.startsWith('.env.')) return 'plaintext';
  if (name.startsWith('dockerfile.') || name.startsWith('containerfile.')) return 'docker';
  return undefined;
};

/** Highlighting language for escaped source, preferring a known filename over the MIME type. */
export const getFileLanguageName = (fileName: unknown, mimeType: unknown): string => {
  const base = getBaseMimeType(mimeType);
  return (
    getFileNameLanguage(fileName) ??
    LANGUAGE_BY_TEXT_MIME_TYPE.get(base) ??
    MIME_LANGUAGE_SUFFIXES.find((suffix) => base.endsWith(suffix)) ??
    'plaintext'
  );
};

/** Whether the declared type or a fallback filename makes this eligible for a source preview. */
export const isTextPreviewableFile = (fileName: unknown, mimeType: unknown): boolean => {
  const base = getBaseMimeType(mimeType);
  return (
    base.startsWith('text/') ||
    LANGUAGE_BY_TEXT_MIME_TYPE.has(base) ||
    (FILENAME_FALLBACK_MIME_TYPES.has(base) && getFileNameLanguage(fileName) !== undefined)
  );
};

const NUL_SNIFF_BYTES = 8192;

/** Decode a source preview, or return undefined if a NUL in the prefix suggests binary data. */
export const decodeInlinePreviewText = (bytes: ArrayBuffer): string | undefined => {
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, NUL_SNIFF_BYTES));
  // UTF-16 text commonly contains zero bytes. Check the BOM before sniffing for binary data.
  if (prefix[0] === 0xff && prefix[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (prefix[0] === 0xfe && prefix[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (prefix.includes(0)) return undefined;
  return new TextDecoder().decode(bytes);
};
