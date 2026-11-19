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

const libraryRequests = (page: Page) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script' || request.resourceType() === 'stylesheet') {
      requests.push(
        new URL(request.url()).pathname.replace(/canvas-libs-[0-9a-f]+/, 'canvas-libs')
      );
    }
  });
  return requests;
};

test("a canvas runs Chart.js, D3, Mermaid and KaTeX from Chat's own origin, inline and in the panel", async ({
  context,
  page,
}) => {
  const requests = libraryRequests(page);
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

  const loaded = requests.filter((path) => path.includes('/canvas-libs/'));
  expect(new Set(loaded)).toEqual(
    new Set([
      '/assets/canvas-libs/chart.umd.min.js',
      '/assets/canvas-libs/d3.min.js',
      '/assets/canvas-libs/mermaid.min.js',
      '/assets/canvas-libs/katex.min.css',
      '/assets/canvas-libs/katex.min.js',
      '/assets/canvas-libs/auto-render.min.js',
    ])
  );
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
