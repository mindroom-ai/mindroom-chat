import { expect, test, type Page } from '@playwright/test';

// Drives the computer screen's touchpad through the real noVNC client, against an RFB server
// stub on the page's WebSocket, and checks the PointerEvents that reach the computer.

type PointerEvent = { mask: number; x: number; y: number };
type Point = { x: number; y: number };

// Touch emulation under any config: the base config's Chromium has none.
test.use({ hasTouch: true });

// RFB button masks.
const NONE = 0;
const LEFT = 1;
const RIGHT = 4;
const WHEEL_DOWN = 16;

const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 250;
// The touchpad pointer starts at the centre of the screen.
const CENTRE = { x: FRAME_WIDTH / 2, y: FRAME_HEIGHT / 2 };

const WEBKIT_TAPS_ONLY =
  "Playwright's WebKit touchscreen can only tap: there is no touch move or second finger";

type RfbStub = {
  pointerEvents: PointerEvent[];
  framed: boolean;
  errors: string[];
};

const u16 = (value: number) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
};

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

const serverInit = () => {
  const name = Buffer.from('Touchpad test', 'latin1');
  // 32 bpp, depth 24, little endian, true colour, 255 per channel, red at bit 16.
  const pixelFormat = Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
  return Buffer.concat([u16(FRAME_WIDTH), u16(FRAME_HEIGHT), pixelFormat, u32(name.length), name]);
};

// One Raw rectangle over the whole frame, in the pixel format noVNC asked for.
const fullFrame = () => {
  const pixels = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([0x4a, 0x63, 0x78, 0xff], offset);
  }
  const rect = Buffer.concat([u16(0), u16(0), u16(FRAME_WIDTH), u16(FRAME_HEIGHT), u32(0)]);
  return Buffer.concat([Buffer.from([0, 0]), u16(1), rect, pixels]);
};

// An RFB 3.8 server with no authentication. After the handshake it reads every client message
// by its type, so it stays in step, and records each PointerEvent.
const serveRfb = async (page: Page): Promise<RfbStub> => {
  const stub: RfbStub = { pointerEvents: [], framed: false, errors: [] };
  await page.routeWebSocket('**/rfb-stub', (ws) => {
    let phase: 'version' | 'security' | 'clientInit' | 'messages' | 'lost' = 'version';
    let input = Buffer.alloc(0);

    const fail = (error: string) => {
      stub.errors.push(error);
      phase = 'lost';
      return 0;
    };

    // The length of the next client message once all of it has arrived, else 0.
    const complete = (length: number) => (input.length >= length ? length : 0);

    const takeMessage = (): number => {
      const type = input[0];
      switch (type) {
        case 0: // SetPixelFormat
          return complete(20);
        case 2: // SetEncodings
          return input.length < 4 ? 0 : complete(4 + 4 * input.readUInt16BE(2));
        case 3: {
          // FramebufferUpdateRequest
          const length = complete(10);
          if (length && !stub.framed) {
            stub.framed = true;
            ws.send(fullFrame());
          }
          return length;
        }
        case 4: // KeyEvent
          return complete(8);
        case 5: {
          // PointerEvent
          const length = complete(6);
          if (length) {
            stub.pointerEvents.push({
              mask: input[1],
              x: input.readUInt16BE(2),
              y: input.readUInt16BE(4),
            });
          }
          return length;
        }
        case 6: // ClientCutText, negative for the extended clipboard
          return input.length < 8 ? 0 : complete(8 + Math.abs(input.readInt32BE(4)));
        default:
          return fail(`unknown client message type ${type}`);
      }
    };

    const take = (): number => {
      if (input.length === 0) return 0;
      switch (phase) {
        case 'version': {
          if (!complete(12)) return 0;
          const version = input.toString('latin1', 0, 12);
          if (version !== 'RFB 003.008\n') return fail(`client version ${JSON.stringify(version)}`);
          phase = 'security';
          ws.send(Buffer.from([1, 1])); // one security type: None
          return 12;
        }
        case 'security':
          if (input[0] !== 1) return fail(`security type ${input[0]}`);
          phase = 'clientInit';
          ws.send(u32(0)); // SecurityResult: OK
          return 1;
        case 'clientInit':
          phase = 'messages';
          ws.send(serverInit());
          return 1;
        case 'messages':
          return takeMessage();
        case 'lost':
          return 0;
        // no default
      }
    };

    ws.onMessage((message) => {
      const bytes = typeof message === 'string' ? Buffer.from(message, 'latin1') : message;
      input = Buffer.concat([input, bytes]);
      for (let used = take(); used > 0; used = take()) input = input.subarray(used);
    });
    ws.send(Buffer.from('RFB 003.008\n', 'latin1'));
  });
  return stub;
};

// The stub of the running test, whose PointerEvents are attached to its result.
let current: RfbStub | undefined;

// Playwright reads fixtures from the first argument, so it must be a pattern, even an empty one.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (!current) return;
  await testInfo.attach('pointer-events', {
    body: JSON.stringify(current.pointerEvents),
    contentType: 'application/json',
  });
  current = undefined;
});

const openScreen = async (page: Page, mode: 'view' | 'control') => {
  const stub = await serveRfb(page);
  current = stub;
  await page.goto(`/e2e/fixtures/computer-touchpad.html?mode=${mode}`);
  // A touch device, so noVNC draws its own cursor as on a phone. Linux WebKit reports no touch
  // points even with hasTouch, so only Chromium can prove it.
  if (page.context().browser()?.browserType().name() === 'chromium') {
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
  }
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect.poll(() => stub.framed).toBe(true);
  // noVNC's own canvas; its cursor has another one on the page.
  const box = await page
    .getByRole('application', { name: 'Agent computer' })
    .locator('canvas')
    .boundingBox();
  if (!box) throw new Error('noVNC drew no canvas');
  // A point on the canvas, as fractions of its size.
  const on = (fx: number, fy: number): Point => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  return { stub, on };
};

// Touch input. Chromium takes raw touch points over CDP; WebKit only has Playwright's tap.
const touchscreen = async (page: Page, browserName: string) => {
  if (browserName !== 'chromium') {
    return {
      tap: async (...fingers: Point[]) => {
        if (fingers.length !== 1) throw new Error(WEBKIT_TAPS_ONLY);
        await page.touchscreen.tap(fingers[0].x, fingers[0].y);
      },
      drag: async () => {
        throw new Error(WEBKIT_TAPS_ONLY);
      },
      touch: async () => {
        throw new Error(WEBKIT_TAPS_ONLY);
      },
    };
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: fingers.map(({ x, y }, id) => ({ x, y, id })),
    });
  return {
    // Puts the fingers down together and lifts them.
    tap: async (...fingers: Point[]) => {
      await touch('touchStart', fingers);
      await touch('touchEnd', []);
    },
    // Puts the fingers down together, moves them all by (dx, dy) in steps about a frame
    // apart, and lifts them.
    drag: async (fingers: Point[], dx: number, dy: number, steps: number) => {
      await touch('touchStart', fingers);
      for (let step = 1; step <= steps; step += 1) {
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(20);
        // eslint-disable-next-line no-await-in-loop
        await touch(
          'touchMove',
          fingers.map(({ x, y }) => ({ x: x + (dx * step) / steps, y: y + (dy * step) / steps }))
        );
      }
      await touch('touchEnd', []);
    },
    // One raw touch event, for a gesture that something interrupts.
    touch,
  };
};

const at = (mask: number, { x, y }: Point = CENTRE): PointerEvent => ({ mask, x, y });

// Control arrives on the open stream, as a Take control response does.
const takeControl = async (page: Page) => {
  await page.evaluate(() =>
    (window as unknown as { setComputerMode(mode: 'control'): void }).setComputerMode('control')
  );
  await expect(page.getByRole('application', { name: 'Agent computer' })).toHaveCSS(
    'touch-action',
    'none'
  );
};

// noVNC sends in order, so once a click's press and release arrived, everything the touches
// before it sent has arrived too.
const untilClicked = async (stub: RfbStub) => {
  await expect
    .poll(() => stub.pointerEvents.slice(-2).map(({ mask }) => mask))
    .toEqual([LEFT, NONE]);
  expect(stub.errors).toEqual([]);
  return stub.pointerEvents;
};

test('a one-finger drag moves the pointer without a button', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_TAPS_ONLY);
  const { stub, on } = await openScreen(page, 'control');
  const touch = await touchscreen(page, browserName);

  await touch.drag([on(0.3, 0.5)], 80, 0, 8);
  await touch.tap(on(0.5, 0.5));

  const events = await untilClicked(stub);
  const moves = events.slice(0, -2);
  expect(moves.length).toBeGreaterThanOrEqual(2);
  expect(moves.map(({ mask, y }) => ({ mask, y }))).toEqual(
    moves.map(() => ({ mask: NONE, y: CENTRE.y }))
  );
  moves.forEach(({ x }, index) => expect(x).toBeGreaterThan(index ? moves[index - 1].x : CENTRE.x));
  // The tap clicks where the drag left the pointer.
  const end = moves[moves.length - 1];
  expect(events.slice(-2)).toEqual([at(LEFT, end), at(NONE, end)]);
});

test('a tap clicks at the pointer', async ({ page, browserName }) => {
  const { stub, on } = await openScreen(page, 'control');
  const touch = await touchscreen(page, browserName);

  // Away from the pointer: a touchpad clicks where the pointer is, not under the finger.
  await touch.tap(on(0.25, 0.25));
  // Again elsewhere. noVNC took the mouse on the press; had it kept it, its page-covering
  // capture element would take this tap instead of the screen.
  await touch.tap(on(0.75, 0.75));

  // The first press moves noVNC's cursor to the pointer before it presses.
  await expect
    .poll(() => stub.pointerEvents)
    .toEqual([at(NONE), at(LEFT), at(NONE), at(LEFT), at(NONE)]);
  expect(stub.errors).toEqual([]);
  await expect(page.locator('#noVNC_mouse_capture_elem')).toBeHidden();
});

test('a two-finger tap right-clicks', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_TAPS_ONLY);
  const { stub, on } = await openScreen(page, 'control');
  const touch = await touchscreen(page, browserName);

  // Off the pointer, as noVNC's own two-finger tap right-clicks between the fingers.
  await touch.tap(on(0.2, 0.3), on(0.4, 0.3));

  // The cursor move, then the click, at the pointer.
  await expect.poll(() => stub.pointerEvents).toEqual([at(NONE), at(RIGHT), at(NONE)]);
  expect(stub.errors).toEqual([]);
  await expect(page.locator('#noVNC_mouse_capture_elem')).toBeHidden();
});

test('a two-finger drag scrolls', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_TAPS_ONLY);
  const { stub, on } = await openScreen(page, 'control');
  const touch = await touchscreen(page, browserName);

  // Fingers moving up scroll down, as content follows the fingers.
  await touch.drag([on(0.4, 0.8), on(0.6, 0.8)], 0, -80, 8);
  await touch.tap(on(0.5, 0.5));

  const events = await untilClicked(stub);
  // After the cursor move, each wheel step is a press and a release of the wheel button, at
  // the pointer.
  const steps = (events.length - 3) / 2;
  expect(steps).toBeGreaterThanOrEqual(1);
  expect(events).toEqual([
    at(NONE),
    ...Array.from({ length: steps }, () => [at(WHEEL_DOWN), at(NONE)]).flat(),
    at(LEFT),
    at(NONE),
  ]);
});

test('control taken during a watched drag holds no button', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_TAPS_ONLY);
  const { stub, on } = await openScreen(page, 'view');
  const touch = await touchscreen(page, browserName);
  const start = on(0.3, 0.5);

  // Watching, a drag past 50 px. Had noVNC's own gestures seen it, they would have started a
  // drag, whose left button noVNC keeps while view-only and sends with every move later.
  await touch.touch('touchStart', [start]);
  for (let step = 1; step <= 4; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(20);
    // eslint-disable-next-line no-await-in-loop
    await touch.touch('touchMove', [{ x: start.x + 20 * step, y: start.y }]);
  }
  // Control arrives mid-drag; then the finger lifts.
  await takeControl(page);
  await touch.touch('touchMove', [{ x: start.x + 100, y: start.y }]);
  await touch.touch('touchEnd', []);

  // A new drag moves the pointer without a button, and then a tap clicks.
  await touch.drag([on(0.3, 0.5)], 80, 0, 8);
  await touch.tap(on(0.5, 0.5));

  const events = await untilClicked(stub);
  const moves = events.slice(0, -2);
  expect(moves.length).toBeGreaterThanOrEqual(2);
  expect(moves.map(({ mask }) => mask)).toEqual(moves.map(() => NONE));
});

test('control taken during a watched long press presses no button', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', WEBKIT_TAPS_ONLY);
  const { stub, on } = await openScreen(page, 'view');
  const touch = await touchscreen(page, browserName);

  // Watching, a finger lands and stays. noVNC's own gestures would start their 1 s long-press
  // timer, which presses the right button once it fires.
  await touch.touch('touchStart', [on(0.3, 0.5)]);
  await page.waitForTimeout(200);
  await takeControl(page);
  // Past the long press, then the finger lifts, and a tap clicks.
  await page.waitForTimeout(1000);
  await touch.touch('touchEnd', []);
  await touch.tap(on(0.5, 0.5));

  const events = await untilClicked(stub);
  expect(events.map(({ mask }) => mask)).not.toContain(RIGHT);
  expect(events).toEqual([at(NONE), at(LEFT), at(NONE)]);
});

test('watching sends nothing', async ({ page, browserName }) => {
  const { stub, on } = await openScreen(page, 'view');
  const touch = await touchscreen(page, browserName);
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { touchesSeen: seen });
    ['touchstart', 'touchend'].forEach((type) =>
      window.addEventListener(type, () => seen.push(type), { capture: true })
    );
  });

  await touch.tap(on(0.25, 0.25));

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { touchesSeen: string[] }).touchesSeen))
    .toEqual(['touchstart', 'touchend']);
  // Nothing to wait for when nothing is sent: give noVNC's tap gesture time to finish.
  await page.waitForTimeout(500);
  expect(stub.pointerEvents).toEqual([]);
  expect(stub.errors).toEqual([]);
});
