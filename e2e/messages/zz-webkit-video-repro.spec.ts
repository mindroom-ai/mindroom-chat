import { expect, test } from '@playwright/test';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Scratch: does a bare <video> with a source crash this WebKit, outside the app?
const WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHVEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEiTbuMU6uEHFO7a1OsggG/7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBpAAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBILqBGJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dcPngQCjvoEAAIDQAgCdASogABgAAEcIhYWIhYSIAgICdaoD+AIIIQg9AP76eV//qdP6nT+p0/+p0//cgHsgHsgH79wAHFO7a5G7j7OBALeK94EB8YIBd/CBAw==';

for (const mode of ['none', 'webm-blob', 'garbage-blob', 'audio-blob'] as const) {
  test(`webkit media ${mode}`, async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'no webkit');
    const browser = await launchWebKit();
    try {
      const page = await browser.newPage();
      await page.setContent('<p>media</p>');
      await page.evaluate(
        ({ mode: m, b64 }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const element = document.createElement(m === 'audio-blob' ? 'audio' : 'video');
          if (m === 'webm-blob') element.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
          if (m === 'garbage-blob') element.src = URL.createObjectURL(new Blob(['not a video'], { type: 'video/mp4' }));
          if (m === 'audio-blob') element.src = URL.createObjectURL(new Blob(['not audio'], { type: 'audio/ogg' }));
          document.body.append(element);
        },
        { mode, b64: WEBM }
      );
      await page.waitForTimeout(3000);
      expect(await page.evaluate(() => document.body.childElementCount)).toBe(2);
    } finally {
      await browser.close();
    }
  });
}
