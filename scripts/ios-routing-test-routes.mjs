import { generatePath } from 'react-router-dom';
import * as paths from '../src/app/pages/paths.ts';

// Exercise the web router's real path templates, including absent optional
// parameters. New route families must also resolve through the native handler.
const routes = new Set();
for (const path of Object.values(paths)) {
  if (typeof path !== 'string' || !path.startsWith('/')) continue;
  for (const prefix of ['!', '#']) {
    for (const includeOptional of [false, true]) {
      const values = {
        roomIdOrAlias: `${prefix}room:mindroom.chat`,
        spaceIdOrAlias: `${prefix}space:mindroom.chat`,
        eventId: '$event:matrix.org',
        server: 'mindroom.chat',
      };
      const params = Object.fromEntries(
        [...path.matchAll(/:([\w-]+)(\?)?/g)].map(([, name, optional]) => [
          name,
          optional && !includeOptional ? null : encodeURIComponent(values[name] ?? 'value.example'),
        ])
      );
      routes.add(generatePath(path, { ...params, '*': 'nested/value.example' }));
    }
  }
}
process.stdout.write(`${JSON.stringify([...routes], null, 2)}\n`);
