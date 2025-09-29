# Eyes for Agents

ESM JavaScript library that lets autonomous agents control Chromium via Playwright and observe the page's visual/DOM/a11y/console/network state. Includes WebGL/WebGPU canvas frame capture and a simple step orchestrator.

- Low-level: `AgentEyes` (one session, events, actions)
- High-level: `EyesRunner` (sequential steps with retries)

Status: early preview.
## Codex back
```
 codex resume 019995fe-adc5-7b11-89ef-7a3253e9772f
```
## Install

Requires Node.js 18+.

```
npm i agent-eyes
```

Runtime deps: `playwright`, `zod`, `eventemitter3`, `pino`.

## Quick start

```js
import { AgentEyes, EyesRunner } from 'agent-eyes';

const eyes = new AgentEyes({ headless: true, blockPrivateIPs: true });
await eyes.open();
await eyes.navigate({ url: 'https://webglsamples.org/aquarium/aquarium.html', wait: 'networkidle' });
eyes.on('frame', buf => { /* preview frames (Buffer, webp) */ });
await eyes.click({ text: 'Settings' });
const shot = await eyes.screenshot({ format: 'webp', quality: 70 });
await eyes.close();
```

### Orchestrator

```js
import { AgentEyes, EyesRunner } from 'agent-eyes';

const eyes = new AgentEyes({ headless: true });
await eyes.open();
const runner = new EyesRunner(eyes);
const result = await runner.run({
  goal: 'Open the demo and enable High quality',
  steps: [
    { action: 'navigate', args: { url: 'https://webglsamples.org/aquarium/aquarium.html', wait: 'domcontentloaded' } },
    { action: 'click', args: { text: 'Settings' } },
    { action: 'click', args: { text: 'Quality' } },
    { action: 'click', args: { text: 'High' } },
    { action: 'wait',  args: { for: 'timeout', timeoutMs: 800 } }
  ],
  abortOnError: true,
  maxDurationMs: 120000
});
console.log(result.success, result.lastState);
await eyes.close();
```

## API

### new AgentEyes(options)

Options:
- `viewport?: { width, height }` (default 1280×800)
- `userAgent?: string`
- `headless?: boolean` (default true)
- `allowNavigationTo?: RegExp` (allowlist)
- `blockPrivateIPs?: boolean` (default true; SSRF guard)
- `log?: { level?: 'silent'|'error'|'warn'|'info'|'debug' }`
- `frameStream?: { fps?: number, scaleWidth?: number }`
- `trace?: { enabled?: boolean, file?: string }` (JSONL trace)

Events:
- `frame` → `Buffer` (webp), ~2–4 fps
- `console` → `{ type, text, ts }`
- `network` → `{ url, method, status, ts }`
- `navigated` → `{ url, title }`
- `error` → `{ code, message }`
- `actionCompleted` → `{ action, durationMs }`

Methods (all promise-based):
- `open()`, `close()`, `state()`
- `navigate({ url, wait?, timeoutMs? })`
- `wait({ for: 'selector'|'networkidle'|'timeout', selector?, timeoutMs? })`
- `click({ selector?, text?, nth?, timeoutMs? })`
- `type({ selector, text, delayMs? })`
- `scroll({ x?, y?, intoViewSelector? })`
- `keys({ press })`
- `exec({ expression })` (safe `page.evaluate`)
- `screenshot({ fullPage?, format?, quality? }) → { buffer, dataUrl, mime }`
- `screenshotDataURL(opts?) → string`
- `canvas() → string|null` (last WebGL/WebGPU frame data URL)
- `dom({ maxDepth?, plaintext? }) → object`
- `a11y() → object|null`
- `visualStability({ durationMs?, fps?, threshold? }) → { stable, avgDiff, maxDiff, samples }`
- `domSignature() → { hash, size }`
- `getConsole(n?)`, `getNetwork(n?)`
- `onCanvasFrame(cb)` (alias to `on('frame', cb)`)
- `metrics()`

### EyesRunner

`run({ goal, steps, abortOnError?, maxDurationMs? })`

Step = `{ action: 'navigate'|'click'|'type'|'wait'|'scroll'|'keys'|'exec', args: object }`

Returns `{ success, traceId, lastState, artifacts: { screenshot?, domSnippet? }, error? }`.

Retry policy: 3 attempts with exponential backoff for fragile actions.

## Security

- SSRF guard blocks localhost and RFC1918 ranges when `blockPrivateIPs` is true.
- Optional `allowNavigationTo` RegExp for URL allowlisting.

## Canvas/WebGL/WebGPU

On `open()`, an init script hooks `HTMLCanvasElement.getContext` to detect `webgl`, `webgl2`, `gpupresent`, and `webgpu`. It records the last canvas and stores a `toDataURL('image/webp', 0.8)` preview every ~1s as `window.__EYES.canvasFrame`. `eyes.canvas()` returns this data URL (or `null`). The `frame` event is separate — a low-FPS page screenshot preview.

For environments where WebGPU requires additional flags, pass them via `browserFlags` or switch channel via `browserChannel`:

```js
const eyes = new AgentEyes({
  headless: false,
  browserChannel: 'chrome',
  browserFlags: ['--enable-features=Vulkan,UseSkiaRenderer']
});
```

## Examples

See `examples/basic.mjs` and `examples/orchestrate.mjs`.

## Notes

- ESM-only (`"type":"module"`).
- One instance = one browser context; deterministic timeouts; short stabilization before screenshots.
