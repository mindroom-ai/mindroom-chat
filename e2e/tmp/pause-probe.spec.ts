import { test } from '@playwright/test';

// Throwaway: where a glide holds after a press, by engine and by how it is held.
const VARIANTS = ['pause', 'pause+time', 'place'] as const;

test('pause probe', { tag: '@webkit' }, async ({ page, browserName }) => {
  test.setTimeout(240_000);
  const rows: unknown[] = [];
  for (const variant of VARIANTS) {
    for (const wait of [20, 60, 120]) {
      for (let trial = 0; trial < 4; trial += 1) {
        // eslint-disable-next-line no-await-in-loop
        await page.setContent(
          '<body style="margin:0"><div id="box" style="position:absolute;top:300px;left:0;width:400px;height:200px;background:teal"></div></body>'
        );
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.move(200, 400);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(
          ({ how, lateMs }) => {
            const box = document.getElementById('box') as HTMLElement;
            const animation = box.animate([{ translate: '0px -200px' }, { translate: 'none' }], {
              duration: 280,
              easing: 'cubic-bezier(0.2, 0, 0, 1)',
            });
            const startedAt = performance.now();
            const out: Record<string, unknown> = { how, lateMs };
            (window as unknown as { out: unknown }).out = out;
            const lastFrame = { t: 0, top: 0, ct: 0 };
            const frame = () => {
              lastFrame.t = performance.now();
              lastFrame.top = box.getBoundingClientRect().top;
              lastFrame.ct = Number(animation.currentTime);
              if (!out.done) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            window.addEventListener(
              'pointerdown',
              (event) => {
                out.sinceStart = performance.now() - startedAt;
                out.sinceFrame = performance.now() - lastFrame.t;
                out.frameTop = lastFrame.top;
                out.frameCt = lastFrame.ct;
                out.target = (event.target as Element).id || (event.target as Element).tagName;
                out.ctFirst = Number(animation.currentTime);
                out.top0 = box.getBoundingClientRect().top;
                out.translate0 = getComputedStyle(box).translate;
                out.timeline = Number(document.timeline.currentTime);
                const ct = animation.currentTime;
                animation.pause();
                if (how === 'pause+time') animation.currentTime = ct;
                if (how === 'place') {
                  // The time at which the glide shows where it shows now: the curve read backwards.
                  const shown = parseFloat(getComputedStyle(box).translate.split(' ')[1] ?? '0');
                  const done = 1 - shown / -200;
                  let low = 0;
                  let high = 1;
                  for (let step = 0; step < 24; step += 1) {
                    const s = (low + high) / 2;
                    if (3 * s * s - 2 * s * s * s < done) low = s;
                    else high = s;
                  }
                  const s = (low + high) / 2;
                  animation.currentTime = 280 * (0.6 * s * (1 - s) * (1 - s) + s * s * s);
                }
                out.ctSet = Number(animation.currentTime);
                out.top1 = box.getBoundingClientRect().top;
                const end = performance.now() + lateMs;
                while (performance.now() < end) Math.random();
                out.top2 = box.getBoundingClientRect().top;
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    out.top3 = box.getBoundingClientRect().top;
                    out.ctEnd = Number(animation.currentTime);
                    out.under = document.elementFromPoint(event.clientX, event.clientY)?.id || 'none';
                    out.done = true;
                  })
                );
              },
              { once: true }
            );
          },
          { how: variant, lateMs: 100 }
        );
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(wait);
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.down();
        // eslint-disable-next-line no-await-in-loop
        await page.waitForFunction(() => (window as unknown as { out: { done?: boolean } }).out.done);
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.up();
        // eslint-disable-next-line no-await-in-loop
        rows.push(await page.evaluate(() => (window as unknown as { out: unknown }).out));
      }
    }
  }
  rows.forEach((row) => console.log(`PAUSE-PROBE ${browserName} ${JSON.stringify(row)}`));
});
