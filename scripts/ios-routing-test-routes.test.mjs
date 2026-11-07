// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appRoutePatterns, routeExamples } from './ios-routing-test-routes.mjs';

test('fills every parameter with encoded samples, optional segments with and without', () => {
  assert.deepEqual(
    routeExamples(['/', '/home/:roomIdOrAlias/:eventId?/', '/settings/:page?/'], {
      roomIdOrAlias: ['!room:mindroom.chat', '#room:matrix.org'],
      eventId: ['$event:matrix.org'],
      page: ['general'],
    }),
    [
      '/',
      '/home/!room%3Amindroom.chat/%24event%3Amatrix.org',
      '/home/!room%3Amindroom.chat',
      '/home/%23room%3Amatrix.org/%24event%3Amatrix.org',
      '/home/%23room%3Amatrix.org',
      '/settings/general',
      '/settings',
    ]
  );
});

test('refuses a parameter without sample values', () => {
  assert.throws(() => routeExamples(['/files/:name/'], {}), /No sample value for :name/);
});

test('covers every route pattern of the app', async () => {
  const patterns = await appRoutePatterns();
  assert.ok(patterns.includes('/:spaceIdOrAlias/:roomIdOrAlias/:eventId?/'));
  const routes = routeExamples(patterns);
  assert.ok(routes.every((route) => route.startsWith('/') && !route.includes(':')));
  assert.ok(routes.includes('/explore/mindroom.chat'));
  assert.ok(routes.includes('/p/example'));
  assert.ok(routes.includes('/%23space%3Amatrix.org/!room%3Amindroom.chat/%24event%3Amatrix.org'));
});
