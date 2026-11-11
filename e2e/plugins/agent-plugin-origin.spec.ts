import { expect, test } from '../helpers/agentStack';

// A plugin directory whose MindRoom plugin has an `origin_module` (scripts/agent-stack/stack.py's docstring).
// It needs E2E_PLUGIN_DIRS to name e2e/fixtures/origin-plugin, or a copy of it:
//   E2E_PLUGIN_DIRS=e2e/fixtures/origin-plugin just e2e-slot 3 --preview npx playwright test <this spec>
test.describe.configure({ timeout: 300_000 });

test("a plugin directory's origin_module serves its pages on the plugin's own hosts", async ({
  page,
  stack,
}) => {
  test.skip(
    !stack.pluginDirs?.some(({ plugin, origins }) => plugin === 'e2e-origin' && origins),
    'E2E_PLUGIN_DIRS names no copy of e2e/fixtures/origin-plugin'
  );
  expect(stack.pluginOriginPort).toBe(29800 + stack.slot);
  for (const label of ['preview', 'other']) {
    const host = `${label}.e2e-origin.localhost`;
    await page.goto(`http://${host}:${stack.pluginOriginPort}/`);
    await expect(page.getByText(`Served on ${host}`, { exact: true })).toBeVisible();
  }
});
