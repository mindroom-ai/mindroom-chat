import { defineConfig, devices } from '@playwright/test';
import config from './playwright.config';

export default defineConfig(config, {
  testMatch: 'computer-touchpad.spec.ts',
  projects: [
    // Merged by name into the base Chromium project, which keeps its executable.
    { name: 'chromium', use: { hasTouch: true } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
});
