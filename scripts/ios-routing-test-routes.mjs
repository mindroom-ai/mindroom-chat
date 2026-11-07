// Prints, as a JSON array, one concrete path for every way to fill each route pattern that
// src/app/routes/paths.ts exports. scripts/ios-routing-test-project.rb writes them to
// web-routes.json, and ios/Tests/AssetRoutingTests.swift checks that the native asset handler
// answers each one with index.html. The paths are built as the app builds its links (React
// Router's generatePath with encodeURIComponent values), from Matrix IDs and server names whose
// dots look like file extensions to that handler; an optional segment appears with and without.
import { build } from 'esbuild';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatePath } from 'react-router-dom';

const PATHS_MODULE = fileURLToPath(new URL('../src/app/routes/paths.ts', import.meta.url));

// Sample values per route parameter, unencoded. A new parameter needs its own entry here.
export const ROUTE_PARAM_SAMPLES = {
  server: ['mindroom.chat'],
  roomIdOrAlias: ['!room:mindroom.chat', '#room:matrix.org'],
  spaceIdOrAlias: ['!space:mindroom.chat', '#space:matrix.org'],
  eventId: ['$event:matrix.org'],
  page: ['general'],
  pluginId: ['example'],
};

/** Every concrete path of the patterns, in their order, without duplicates. */
export const routeExamples = (patterns, samples = ROUTE_PARAM_SAMPLES) => {
  const paths = patterns.flatMap((pattern) => {
    const params = [...pattern.matchAll(/:(\w+)(\?)?/g)].map(([, name, optional]) => {
      if (!samples[name]) throw new Error(`No sample value for :${name} (${pattern})`);
      const values = samples[name].map((value) => encodeURIComponent(value));
      return { name, values: optional ? [...values, null] : values };
    });
    const fillings = params.reduce(
      (partial, { name, values }) =>
        partial.flatMap((filled) => values.map((value) => ({ ...filled, [name]: value }))),
      [{}]
    );
    return fillings.map((filled) => generatePath(pattern, filled));
  });
  return [...new Set(paths)];
};

/** The route patterns that paths.ts exports, read from the module itself. */
export const appRoutePatterns = async () => {
  const { outputFiles } = await build({
    entryPoints: [PATHS_MODULE],
    bundle: true,
    write: false,
    format: 'esm',
    logLevel: 'error',
  });
  const source = Buffer.from(outputFiles[0].text).toString('base64');
  const paths = await import(`data:text/javascript;base64,${source}`);
  return Object.values(paths).filter((value) => typeof value === 'string');
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const routes = routeExamples(await appRoutePatterns());
  process.stdout.write(`${JSON.stringify(routes, null, 2)}\n`);
}
