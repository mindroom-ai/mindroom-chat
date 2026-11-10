/* eslint-env node */
// The import resolver of .eslintrc.plugin.cjs: Node's, and for a specifier with a JavaScript
// extension that names no file, the same specifier without it, so `./registry.js` finds
// registry.ts as TypeScript resolves it.
const node = require('eslint-import-resolver-node');

exports.interfaceVersion = 2;
exports.resolve = (source, file, config) => {
  const found = node.resolve(source, file, config);
  const bare = source.replace(/\.(js|jsx|mjs)$/, '');
  return found.found || bare === source ? found : node.resolve(bare, file, config);
};
