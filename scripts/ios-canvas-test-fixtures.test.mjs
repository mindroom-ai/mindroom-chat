// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appFramePolicy, canvasTestFixtures, CHART_JS_URL } from './ios-canvas-test-fixtures.mjs';

const page = (...policies) =>
  `<html><head>${policies
    .map((policy) => `<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .join('')}</head></html>`;

test("joins the app's policies into one", () => {
  assert.equal(
    appFramePolicy(page("frame-src 'self'", "object-src 'none'; base-uri 'self'")),
    "frame-src 'self'; object-src 'none'; base-uri 'self'"
  );
  assert.throws(() => appFramePolicy(page()), /no Content-Security-Policy/);
  // Merged, the second frame-src would be ignored, so two policies that share one stay an error.
  assert.throws(
    () => appFramePolicy(page("frame-src 'self'", "frame-src 'none'")),
    /share a directive/
  );
});

test('builds both canvases with the production canvas document', async () => {
  const fixtures = await canvasTestFixtures();
  assert.deepEqual(Object.keys(fixtures).sort(), [
    'appFramePolicy',
    'attack',
    'chart',
    'permissions',
    'sandbox',
  ]);
  assert.ok(Object.values(fixtures).every((value) => typeof value === 'string' && value !== ''));
  assert.equal(fixtures.sandbox, 'allow-scripts allow-forms');
  assert.match(fixtures.appFramePolicy, /^frame-src 'self' /);
  const librarySource = "script-src 'unsafe-inline' https://cdn.jsdelivr.net/npm/";
  assert.ok(fixtures.chart.includes(librarySource) && fixtures.chart.includes(CHART_JS_URL));
  assert.ok(!fixtures.attack.includes(librarySource));
  assert.ok(fixtures.attack.includes('nativeCanvasProbe'));
});
