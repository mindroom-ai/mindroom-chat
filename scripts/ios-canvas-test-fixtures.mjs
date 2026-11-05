// Prints, as one JSON object of strings, the production canvas that
// ios/Tests/NativeBridgeSecurityTests.swift loads in the native app: the sandbox and permissions
// of the canvas panel's frame, the app's own Content-Security-Policy (from index.html, which the
// test adds to its page so the canvas inherits it as in the app), and two canvas documents built
// by the app's own buildCanvasDocument. scripts/ios-routing-test-project.rb writes the object to
// canvas-fixtures.json. Each canvas posts one message with `nativeCanvasProbe` to the app window:
// `attack` reports what a hostile page could reach (bridge, sessionAccess, handler), and `chart`
// loads Chart.js from the npm source a deployment can allow and reports whether it drew (chart,
// painted).
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const CANVAS_MODULE = fileURLToPath(new URL('src/app/messages/canvas/canvasDocument.ts', ROOT));

// The URL that MindRoom's chat_ui tool gives agents as its Chart.js example.
export const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

// Runs in the canvas frame, a sandboxed frame with an opaque origin inside the panel's wrapper
// frame. It must not reach the Capacitor bridge, the app's Matrix sessions (the app origin's
// localStorage and IndexedDB; with an opaque origin, any web storage at all) or WebKit's native
// message handler. It tries all of them. Cookies are left to the subframe test: WebKit answers
// document.cookie with "" in a srcdoc frame, which reaches nothing.
const ATTACK_PAGE = `<p>Hostile canvas probe</p>
<script>
(async () => {
  const reads = (probe) => {
    try {
      probe();
      return true;
    } catch {
      return false;
    }
  };
  const opensDatabase = () => new Promise((resolve) => {
    setTimeout(() => resolve(false), 2000);
    try {
      const request = indexedDB.open('routing-session');
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  const storage = [
    () => parent.parent.localStorage.getItem('routing-session'),
    () => localStorage.getItem('routing-session'),
    () => sessionStorage.getItem('routing-session'),
  ].some(reads);
  let handler = 'unavailable';
  try {
    webkit.messageHandlers.bridge.postMessage({
      type: 'message', pluginId: 'BridgeProbe', methodName: 'record', callbackId: 'hostile-canvas', options: {},
    });
    handler = 'posted';
  } catch {}
  const sessionAccess = storage || (await opensDatabase());
  parent.parent.postMessage({ nativeCanvasProbe: true, bridge: typeof window.Capacitor, sessionAccess, handler }, '*');
})();
</script>`;

// Draws a bar chart without animation once Chart.js has loaded (or failed to), then reports
// whether the canvas holds any painted pixel.
const CHART_PAGE = `<canvas id="chart" width="320" height="200"></canvas>
<script src="${CHART_JS_URL}"></script>
<script>
addEventListener('load', () => {
  let painted = false;
  if (typeof Chart === 'function') {
    const canvas = document.getElementById('chart');
    new Chart(canvas, {
      type: 'bar',
      data: { labels: ['A', 'B', 'C'], datasets: [{ data: [3, 5, 2], backgroundColor: '#3f6bdb' }] },
      options: { animation: false, responsive: false },
    });
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    painted = pixels.some((value, index) => index % 4 === 3 && value > 0);
  }
  parent.parent.postMessage({ nativeCanvasProbe: true, chart: typeof Chart, painted }, '*');
});
</script>`;

/** The app's policies from index.html's meta elements, as one policy (they share no directive). */
export const appFramePolicy = (indexHtml) => {
  const { document } = new JSDOM(indexHtml).window;
  const policies = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')]
    .map((meta) => meta.getAttribute('content')?.trim() ?? '')
    .filter(Boolean);
  if (policies.length === 0) throw new Error('index.html has no Content-Security-Policy');
  const directives = policies.flatMap((policy) => policy.split(';').map((part) => part.trim()));
  const names = directives.filter(Boolean).map((directive) => directive.split(/\s+/)[0]);
  if (new Set(names).size !== names.length) {
    // Two policies that name one directive both apply; a single merged policy would keep only the first.
    throw new Error(`index.html's policies share a directive: ${names.join(', ')}`);
  }
  return policies.join('; ');
};

/** The fixtures object, built from the app's canvas module and index.html. */
export const canvasTestFixtures = async () => {
  const { outputFiles } = await build({
    entryPoints: [CANVAS_MODULE],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'error',
  });
  const source = Buffer.from(outputFiles[0].text).toString('base64');
  const canvas = await import(`data:text/javascript;base64,${source}`);
  return {
    sandbox: canvas.CANVAS_WRAPPER_SANDBOX,
    permissions: canvas.CANVAS_PERMISSIONS,
    appFramePolicy: appFramePolicy(readFileSync(new URL('index.html', ROOT), 'utf8')),
    attack: canvas.buildCanvasDocument(ATTACK_PAGE, 'light', undefined, 'Hostile canvas probe'),
    chart: canvas.buildCanvasDocument(CHART_PAGE, 'light', undefined, 'Chart canvas probe', true),
  };
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await canvasTestFixtures(), null, 2)}\n`);
}
