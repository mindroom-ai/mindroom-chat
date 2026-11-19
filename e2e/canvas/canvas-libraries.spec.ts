import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { openPanelRoom, type PanelRoom } from '../helpers/sidePanels';

// A canvas that names libraries (`canvas.libraries`) loads Chat's own pinned copies of them from
// Chat's origin, with jsDelivr off, under the canvas policy: no eval, no workers, no connections.
// Each library draws something real, inline in the thread and again in the panel.
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 900 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const sendCanvas = (room: PanelRoom, title: string, html: string, libraries: string[]) =>
  sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${title}. Open it in MindRoom Chat to respond.`,
    'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: room.viewer.userId,
      agent_user_id: room.agent.userId,
      room_id: room.roomId,
      thread_id: room.rootId,
      inline: true,
      canvas: { title, html, libraries },
    },
  });

// Each check writes its result into #result, with every policy violation the page saw.
const LIBRARY_PAGE = `<canvas id="chart" width="300" height="150"></canvas>
<div id="bars"></div><div id="diagram"></div>
<p id="math">Euler: $e^{i\\pi} + 1 = 0$</p>
<pre id="result">running</pre>
<script>
  const violations = [];
  document.addEventListener('securitypolicyviolation', (event) =>
    violations.push(event.effectiveDirective + ' ' + event.blockedURI));
  (async () => {
    const results = {};
    const check = async (name, run) => {
      try { results[name] = (await run()) ? 'ok' : 'failed'; }
      catch (error) { results[name] = 'error ' + error; }
    };
    await check('chartjs', () => {
      new Chart(document.getElementById('chart'), { type: 'bar', options: { animation: false },
        data: { labels: ['a', 'b', 'c'], datasets: [{ data: [3, 5, 2], backgroundColor: '#36a' }] } });
      const pixels = document.getElementById('chart').getContext('2d').getImageData(0, 0, 300, 150).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    });
    await check('d3', () => {
      d3.select('#bars').append('svg').attr('width', 90).attr('height', 20).selectAll('rect')
        .data([1, 2, 3]).join('rect').attr('x', (d) => d * 20).attr('width', 15).attr('height', (d) => d * 5);
      return document.querySelectorAll('#bars rect').length === 3;
    });
    await check('mermaid', async () => {
      mermaid.initialize({ startOnLoad: false });
      const { svg } = await mermaid.render('flow', 'flowchart LR\\n  A[Ask] --> B{Pick}\\n  B -->|yes| C[Done]\\n  B -->|no| A');
      document.getElementById('diagram').innerHTML = svg;
      return document.querySelectorAll('#diagram .node').length === 3;
    });
    await check('katex', async () => {
      renderMathInElement(document.getElementById('math'), {
        delimiters: [{ left: '$', right: '$', display: false }],
      });
      await document.fonts.ready;
      return !!document.querySelector('#math .katex') && document.fonts.check('16px KaTeX_Main');
    });
    document.getElementById('result').textContent =
      JSON.stringify({ ...results, violations });
  })();
</script>`;

const ALL_RIGHT = JSON.stringify({
  chartjs: 'ok',
  d3: 'ok',
  mermaid: 'ok',
  katex: 'ok',
  violations: [],
});

const expectLibrariesWork = async (frame: FrameLocator) => {
  await expect(frame.locator('#result')).toHaveText(ALL_RIGHT, { timeout: 30_000 });
  await expect(frame.locator('#diagram svg')).toBeVisible();
  await expect(frame.locator('#math .katex')).toBeVisible();
};

/** Every request the canvas frames make (the page's own frames make none), by its full address. */
const canvasRequests = (page: Page) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.frame().parentFrame()) requests.push(request.url());
  });
  return requests;
};

test("a canvas runs Chart.js, D3, Mermaid and KaTeX from Chat's own origin, inline and in the panel", async ({
  context,
  page,
}) => {
  const requests = canvasRequests(page);
  const room = await openPanelRoom(context, page);
  await sendCanvas(room, 'Library tour', LIBRARY_PAGE, ['chartjs', 'd3', 'mermaid', 'katex']);

  await expect(page.locator('iframe[title="Library tour"]')).toBeVisible({ timeout: 60_000 });
  await expectLibrariesWork(
    page.frameLocator('iframe[title="Library tour"]').frameLocator('iframe')
  );
  await page
    .locator('iframe[title="Library tour"]')
    .screenshot({ path: test.info().outputPath('canvas-libraries-inline.png') });

  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  const panel = page.locator('aside[aria-label="Canvas panel"]');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expectLibrariesWork(panel.frameLocator('iframe').frameLocator('iframe'));
  // The panel lists the page's errors; a library that failed to load or was blocked would be one.
  await expect(panel.locator('pre')).toHaveCount(0);
  await panel.screenshot({ path: test.info().outputPath('canvas-libraries-panel.png') });

  // Every library request goes to Chat's own origin (jsDelivr is off), and nothing else is requested.
  const origin = new URL(page.url()).origin;
  const directory = new RegExp(
    `^${origin.replace(/[.]/g, '\\.')}/assets/canvas-libs-[0-9a-f]{12}/`
  );
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((url) => !directory.test(url))).toEqual([]);
  expect(new Set(requests.map((url) => url.replace(directory, '')))).toEqual(
    new Set([
      'chart.umd.min.js',
      'd3.min.js',
      'mermaid.min.js',
      'katex.min.css',
      'katex.min.js',
      'auto-render.min.js',
    ])
  );
});

// Only the exact files a page names are allowed: another library file, an address that climbs out
// of the directory, and its encoded spellings are all blocked before a request leaves the frame.
const ESCAPE_PAGE = `<pre id="result">running</pre>
<script>
  const blocked = [];
  document.addEventListener('securitypolicyviolation', (event) => blocked.push(event.blockedURI));
  const directory = document.querySelector('script[src$="d3.min.js"]').src.replace(/d3[.]min[.]js$/, '');
  const tries = [
    ['script', 'chart.umd.min.js'],
    ['script', '../../runtime-config.js'],
    ['script', '%2e%2e/%2e%2e/runtime-config.js'],
    ['script', '..%2F..%2Fruntime-config.js'],
    ['script', '..%252F..%252Fruntime-config.js'],
    ['style', '..%2F..%2Fpublic%2Flicenses%2FNOTICE'],
  ];
  Promise.all(tries.map(([kind, path]) => new Promise((resolve) => {
    const element = document.createElement(kind === 'script' ? 'script' : 'link');
    if (kind === 'script') element.src = directory + path; else { element.rel = 'stylesheet'; element.href = directory + path; }
    element.onload = () => resolve(path + ' loaded');
    element.onerror = () => resolve(path + ' failed');
    document.head.append(element);
  }))).then((results) => setTimeout(() => {
    document.getElementById('result').textContent = JSON.stringify({ d3: typeof d3, results, blocked: blocked.length > 0 });
  }, 200));
</script>`;

test('a canvas page can load only the exact library files it names, not other files of the directory or outside it', async ({
  context,
  page,
}) => {
  const requests = canvasRequests(page);
  const room = await openPanelRoom(context, page);
  await sendCanvas(room, 'Escape probe', ESCAPE_PAGE, ['d3']);
  const frame = page.frameLocator('iframe[title="Escape probe"]').frameLocator('iframe');
  await expect(frame.locator('#result')).toHaveText(
    JSON.stringify({
      d3: 'object',
      results: [
        'chart.umd.min.js failed',
        '../../runtime-config.js failed',
        '%2e%2e/%2e%2e/runtime-config.js failed',
        '..%2F..%2Fruntime-config.js failed',
        '..%252F..%252Fruntime-config.js failed',
        '..%2F..%2Fpublic%2Flicenses%2FNOTICE failed',
      ],
      blocked: true,
    }),
    { timeout: 60_000 }
  );
  // The policy stopped each one in the frame: the only request that left it was d3 itself.
  expect(
    requests.map((url) => new URL(url).pathname.replace(/canvas-libs-[0-9a-f]+/, 'canvas-libs'))
  ).toEqual(['/assets/canvas-libs/d3.min.js']);
});

test('a canvas that names a library Chat does not serve says so in the errors the user can report', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  await sendCanvas(
    room,
    'Unknown library',
    '<p id="drawn">Drawn without it</p><script>window.Plotly || (drawn.dataset.plotly = "missing")</script>',
    ['d3', 'plotly']
  );
  const inline = page.frameLocator('iframe[title="Unknown library"]').frameLocator('iframe');
  await expect(inline.locator('#drawn')).toHaveAttribute('data-plotly', 'missing', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  const panel = page.locator('aside[aria-label="Canvas panel"]');
  await expect(panel.locator('pre')).toHaveText(
    'Unknown library "plotly"; Chat serves chartjs, d3, mermaid, katex',
    { timeout: 30_000 }
  );
  await expect(panel.frameLocator('iframe').frameLocator('iframe').locator('#drawn')).toBeVisible();
});
