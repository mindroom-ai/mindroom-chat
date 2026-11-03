// computer-api-cookies.spec.ts imports `./api.js` inside the page: the test's HTTP server bundles
// the computer API client with esbuild and serves it at `/api.js`. These are its types.
export * from '../src/app/mindroom/computer/api';
