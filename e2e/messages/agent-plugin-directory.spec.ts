import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as pageTest } from '@playwright/test';
import {
  bodyOf,
  expect,
  messageRow,
  openThread,
  STACK_SCRIPT,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// The agent stack with a plugin directory (scripts/agent-stack/stack.py's docstring). The first three tests need
// E2E_PLUGIN_DIRS to name e2e/fixtures/sample-plugin, or a copy of it: the first two for the stack, the third for
// the app server:
//   E2E_PLUGIN_DIRS=e2e/fixtures/sample-plugin just e2e-slot 3 --preview npx playwright test <this spec>
test.describe.configure({ timeout: 300_000 });

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url));

/** The directory of E2E_PLUGIN_DIRS that holds the sample plugin, by its real path, as the stack names it. */
const sampleEntry = (process.env.E2E_PLUGIN_DIRS ?? '')
  .split(delimiter)
  .filter(Boolean)
  .map((entry) => resolve(REPOSITORY, entry))
  .find((directory) => {
    const manifest = join(directory, 'mindroom.plugin.json');
    return (
      existsSync(manifest) &&
      (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === 'e2e-sample'
    );
  });
const sampleDir = sampleEntry === undefined ? undefined : realpathSync(sampleEntry);

test("a plugin directory's scenario drives the stub to its plugin's tool", async ({
  page,
  stack,
}) => {
  test.skip(!sampleDir, 'E2E_PLUGIN_DIRS names no copy of e2e/fixtures/sample-plugin');
  test.skip(stack.model === 'real', "A plugin directory's scenarios drive the stub model only");
  const dir = sampleDir ?? '';
  expect(stack.pluginDirs).toContainEqual({
    dir,
    plugin: 'e2e-sample',
    tools: ['e2e_sample'],
    scenarios: join(dir, 'e2e/stub-scenarios.json'),
    scenarioModule: join(dir, 'e2e/stub_scenarios.py'),
    origins: false,
  });

  // The directory's scenario makes the stub call the plugin's tool, whose answer the reply quotes.
  const rootId = await startThread(stack, `${uniqueWord('plugin')} #samplegreet`);
  await openThread(page, stack, rootId);
  const reply = await waitForAgentReply(stack, rootId, (body) =>
    body.includes('Hello Ada, from the sample plugin')
  );
  await expect(messageRow(page, reply.event_id)).toContainText('Hello Ada, from the sample plugin');
});

test("a plugin directory's scenario module passes one tool's result to the next call", async ({
  page,
  stack,
}) => {
  test.skip(!sampleDir, 'E2E_PLUGIN_DIRS names no copy of e2e/fixtures/sample-plugin');
  test.skip(stack.model === 'real', "A plugin directory's scenarios drive the stub model only");
  // The module's #chain makes an item, then uses it by the id the backend's first call returned.
  const rootId = await startThread(stack, `${uniqueWord('chain')} #chain`);
  await openThread(page, stack, rootId);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes('then: Used item-'));
  const text = bodyOf(reply);
  const made = /Made (item-[0-9a-f]{8}), then: Used \1, from the sample plugin/.exec(text);
  expect(made, text).not.toBeNull();
  await expect(messageRow(page, reply.event_id)).toContainText(`Used ${made?.[1] ?? ''}`);
});

// Its own test, without the agent stack, so the page opens in a browser that has not loaded the app: in a
// production build the app's service worker answers later navigations with the app, as it does for
// e2e/fixtures/ pages.
pageTest("a plugin directory's fixture page is served", async ({ page }) => {
  pageTest.skip(!sampleDir, 'E2E_PLUGIN_DIRS names no copy of e2e/fixtures/sample-plugin');
  await page.goto(
    `/e2e-plugins/${encodeURIComponent(basename(sampleDir ?? ''))}/e2e/fixtures/page.html`
  );
  await expect(page.getByText("Rendered by the sample plugin's page")).toBeVisible();
});

test('a plugin that fails its check refuses the start and leaves the running stack', async ({
  stack,
}) => {
  const broken = realpathSync(mkdtempSync(join(tmpdir(), 'broken-plugin-')));
  try {
    writeFileSync(
      join(broken, 'mindroom.plugin.json'),
      JSON.stringify({ name: 'e2e-broken', tools_module: 'missing_tools.py' })
    );
    const refused = spawnSync('python3', [STACK_SCRIPT, String(stack.slot), 'up'], {
      encoding: 'utf8',
      env: { ...process.env, E2E_PLUGIN_DIRS: broken },
      timeout: 10 * 60_000,
    });
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain(
      `agent-stack: the plugin in ${broken} failed \`mindroom plugins check\`: `
    );
    // The check's own detail: the module the manifest names is not there.
    expect(refused.stderr).toContain('missing_tools.py');
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
  const status = spawnSync('python3', [STACK_SCRIPT, String(stack.slot), 'status'], {
    encoding: 'utf8',
  });
  expect(status.status, status.stderr).toBe(0);
  expect((JSON.parse(status.stdout) as { namespace: string }).namespace).toBe(stack.namespace);
});
