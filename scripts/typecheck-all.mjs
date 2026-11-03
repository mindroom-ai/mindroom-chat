// Type-check like `tsc --noEmit -p .`, but report semantic diagnostics even when
// syntax errors exist. Plain `tsc` stops after syntax errors, which hides missing
// modules and type mismatches while blanked lines (docs/provenance/holes.tsv) remain.
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const projectDir = path.resolve(process.argv[2] ?? '.');
const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) {
  console.error(`No tsconfig.json found from ${projectDir}`);
  process.exit(2);
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

const diagnostics = [
  ...parsed.errors,
  ...program.getOptionsDiagnostics(),
  ...program.getGlobalDiagnostics(),
  ...program.getSyntacticDiagnostics(),
  ...program.getSemanticDiagnostics(),
].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

const host = {
  getCurrentDirectory: () => process.cwd(),
  getCanonicalFileName: (fileName) => fileName,
  getNewLine: () => '\n',
};
const report = ts.formatDiagnostics(diagnostics, host);
if (report) process.stdout.write(report);
console.log(`\nFound ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}.`);
process.exit(diagnostics.length === 0 ? 0 : 1);
