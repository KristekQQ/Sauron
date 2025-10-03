import EventEmitter from 'eventemitter3';
import pino from 'pino';
import { z } from 'zod';
import { chromium } from 'playwright';
import { artifacts } from './artifacts.js';
import { detect, injectCanvasHook, getLastCanvasFrame } from './detectors.js';
import { guardNavigation } from './security.js';
import {
  errors,
  ElementNotFoundError,
  NavigationTimeoutError,
  ScriptError,
  SecurityBlockedError,
  BadInputError,
  InternalError,
  toEyesError,
} from './errors.js';

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// Zod schemas
const ViewportSchema = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });
const LogSchema = z.object({ level: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional() }).optional();
const FrameStreamSchema = z.object({ fps: z.number().positive().max(10).optional(), scaleWidth: z.number().int().positive().max(1600).optional() }).optional();
const OptionsSchema = z.object({
  viewport: ViewportSchema.optional(),
  userAgent: z.string().optional(),
  headless: z.boolean().optional(),
  allowNavigationTo: z.instanceof(RegExp).optional(),
  blockPrivateIPs: z.boolean().optional(),
  log: LogSchema,
  frameStream: FrameStreamSchema,
  trace: z.object({ enabled: z.boolean().optional(), file: z.string().optional() }).optional(),
  browserChannel: z.string().optional(),
  browserFlags: z.array(z.string()).optional(),
  canvasHook: z.boolean().optional(),
});

/**
 * @typedef {Object} AgentEyesOptions
 * @property {{width:number,height:number}} [viewport]
 * @property {string} [userAgent]
 * @property {boolean} [headless]
 * @property {RegExp} [allowNavigationTo]
 * @property {boolean} [blockPrivateIPs]
 * @property {{level?: 'silent'|'error'|'warn'|'info'|'debug'}} [log]
 * @property {{fps?: number, scaleWidth?: number}} [frameStream]
 * @property {{enabled?: boolean, file?: string}} [trace]
 */

/**
 * AgentEyes: manage a Playwright Chromium session and expose actions/events
 */
export class AgentEyes extends EventEmitter {
  /**
   * @param {AgentEyesOptions} [options]
   */
  constructor(options = {}) {
    super();
    const parsed = OptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new BadInputError('Invalid options', { data: parsed.error.flatten() });
    }
    /** @type {AgentEyesOptions} */
    this.options = { headless: true, viewport: DEFAULT_VIEWPORT, blockPrivateIPs: true, canvasHook: true, ...options };

    // Logger
    const level = this.options.log?.level === 'silent' ? 'silent' : (this.options.log?.level || 'info');
    this.log = pino({ level, name: 'agent-eyes' });
    /** @type {import('playwright').Browser | null} */
    this.browser = null;
    /** @type {import('playwright').BrowserContext | null} */
    this.context = null;
    /** @type {import('playwright').Page | null} */
    this.page = null;

    this._frameInterval = null;
    this._console = [];
    this._network = [];
    this._metrics = { actions: 0, totalDurationMs: 0, errors: 0 };
    this._traceStream = null;
  }

  /**
   * Launch Chromium and open a new page
   */
  async open() {
    if (this.browser) return;
    const args = [
      '--enable-unsafe-webgpu',
      '--use-angle=auto',
    ].concat(this.options.browserFlags || []);
    const launchOpts = { headless: this.options.headless !== false, args };
    if (this.options.browserChannel) launchOpts.channel = this.options.browserChannel;
    // @ts-ignore Playwright typing in JS context
    this.browser = await chromium.launch(launchOpts);
    const context = await this.browser.newContext({ viewport: this.options.viewport || DEFAULT_VIEWPORT, userAgent: this.options.userAgent });
    this.context = context;
    const page = await context.newPage();
    this.page = page;

    if (this.options.canvasHook !== false) {
      await injectCanvasHook(page);
    }

    // Console events
    page.on('console', (msg) => {
      const rec = { type: msg.type(), text: msg.text(), ts: Date.now() };
      this._pushRing(this._console, rec, 500);
      this.emit('console', rec);
    });

    // Network events (best-effort using route events)
    page.on('requestfinished', (req) => {
      const url = req.url();
      const method = req.method();
      req.response()?.then((res) => {
        const rec = { url, method, status: res?.status() || 0, ts: Date.now() };
        this._pushRing(this._network, rec, 1000);
        this.emit('network', rec);
      }).catch(() => {});
    });
    page.on('requestfailed', (req) => {
      const rec = { url: req.url(), method: req.method(), status: 0, ts: Date.now() };
      this._pushRing(this._network, rec, 1000);
      this.emit('network', rec);
    });

    // Navigation
    page.on('load', async () => {
      try {
        const title = await page.title();
        const url = page.url();
        this.emit('navigated', { url, title });
      } catch (_) {}
    });

    // Frame stream
    this._startFrameStream();
  }

  /** Stop stream and close browser */
  async close() {
    try { if (this._frameInterval) clearInterval(this._frameInterval); } catch (_) {}
    this._frameInterval = null;
    const tasks = [];
    if (this.page) { tasks.push(this.page.close().catch(() => {})); }
    if (this.context) { tasks.push(this.context.close().catch(() => {})); }
    if (this.browser) { tasks.push(this.browser.close().catch(() => {})); }
    await Promise.all(tasks);
    this.browser = null; this.context = null; this.page = null;
  }

  /**
   * @returns {{url:string,title:string,viewport:{width:number,height:number},consoleCount:number,networkCount:number}}
   */
  async state() {
    const page = this._requirePage();
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      viewport: await page.viewportSize() || DEFAULT_VIEWPORT,
      consoleCount: this._console.length,
      networkCount: this._network.length,
    };
  }

  /**
   * Navigate with SSRF guard and allowlist
   * @param {{ url: string, wait?: 'load'|'domcontentloaded'|'networkidle', timeoutMs?: number }} args
   */
  async navigate(args) {
    const start = Date.now();
    const page = this._requirePage();
    if (!args || !args.url) throw new BadInputError('navigate.url is required');
    const url = guardNavigation(args.url, { allowNavigationTo: this.options.allowNavigationTo, blockPrivateIPs: this.options.blockPrivateIPs });
    const waitUntil = args.wait || 'load';
    try {
      await page.goto(url, { waitUntil, timeout: args.timeoutMs ?? 30000 });
      await this._microIdle();
      await this._trace('navigate', args, start, true);
      this._afterAction('navigate', start);
    } catch (e) {
      this._metrics.errors++;
      const err = new NavigationTimeoutError(`Navigation failed: ${url}`, { cause: e });
      await this._trace('navigate', args, start, false, err);
      throw err;
    }
  }

  /**
   * Wait helper
   * @param {{ for: 'selector'|'networkidle'|'timeout', selector?: string, timeoutMs?: number }} args
   */
  async wait(args) {
    const start = Date.now();
    const page = this._requirePage();
    const timeout = args.timeoutMs ?? 10000;
    try {
      if (args.for === 'selector') {
        if (!args.selector) throw new BadInputError('wait.selector is required');
        await page.waitForSelector(args.selector, { timeout, state: 'visible' });
      } else if (args.for === 'networkidle') {
        // Playwright doesn't expose networkidle wait globally; emulate by waiting for no requests for a short idle
        await page.waitForLoadState('networkidle', { timeout });
      } else if (args.for === 'timeout') {
        await page.waitForTimeout(timeout);
      } else throw new BadInputError('wait.for must be selector|networkidle|timeout');
      await this._trace('wait', args, start, true);
      this._afterAction('wait', start);
    } catch (e) {
      this._metrics.errors++;
      const err = toEyesError(e);
      await this._trace('wait', args, start, false, err);
      throw err;
    }
  }

  /**
   * Click by selector or inner text
   * @param {{ selector?: string, text?: string, nth?: number, timeoutMs?: number }} args
   */
  async click(args) {
    const start = Date.now();
    const page = this._requirePage();
    const timeout = args.timeoutMs ?? 10000;
    try {
      let locator = null;
      if (args.selector) {
        locator = page.locator(args.selector);
      } else if (args.text) {
        locator = page.getByText(args.text, { exact: false });
      } else {
        throw new BadInputError('click.selector or click.text required');
      }
      if (typeof args.nth === 'number') locator = locator.nth(args.nth);
      await locator.waitFor({ state: 'visible', timeout });
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout });
      await this._microIdle();
      await this._trace('click', args, start, true);
      this._afterAction('click', start);
    } catch (e) {
      this._metrics.errors++;
      let hint = '';
      if (args?.selector) {
        const similar = await this._suggestSelectors(args.selector).catch(() => []);
        if (similar.length) hint = `Did you mean: ${similar.join(', ')}`;
      }
      const err = new ElementNotFoundError('Element not found for click', { cause: e, hint });
      await this._trace('click', args, start, false, err);
      throw err;
    }
  }

  /**
   * Type into a selector
   * @param {{ selector: string, text: string, delayMs?: number }} args
   */
  async type(args) {
    const start = Date.now();
    const page = this._requirePage();
    if (!args.selector) throw new BadInputError('type.selector is required');
    try {
      const locator = page.locator(args.selector);
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      await locator.click({ timeout: 10000 });
      await page.keyboard.type(args.text || '', { delay: Math.min(Math.max(args.delayMs ?? 20, 0), 200) });
      await this._trace('type', args, start, true);
      this._afterAction('type', start);
    } catch (e) {
      this._metrics.errors++;
      const err = new ElementNotFoundError('Failed to type into element', { cause: e });
      await this._trace('type', args, start, false, err);
      throw err;
    }
  }

  /**
   * Scroll window or element into view
   * @param {{ x?: number, y?: number, intoViewSelector?: string }} args
   */
  async scroll(args = {}) {
    const start = Date.now();
    const page = this._requirePage();
    try {
      if (args.intoViewSelector) {
        const locator = page.locator(args.intoViewSelector);
        await locator.scrollIntoViewIfNeeded();
      }
      if (typeof args.x === 'number' || typeof args.y === 'number') {
        const x = args.x ?? 0; const y = args.y ?? 0;
        await page.evaluate(([x, y]) => window.scrollTo(x, y), [x, y]);
      }
      await this._trace('scroll', args, start, true);
      this._afterAction('scroll', start);
    } catch (e) {
      this._metrics.errors++;
      const err = toEyesError(e);
      await this._trace('scroll', args, start, false, err);
      throw err;
    }
  }

  /**
   * Keyboard press
   * @param {{ press: string }} args
   */
  async keys(args) {
    const start = Date.now();
    const page = this._requirePage();
    try {
      await page.keyboard.press(args.press);
      await this._trace('keys', args, start, true);
      this._afterAction('keys', start);
    } catch (e) {
      this._metrics.errors++;
      const err = toEyesError(e);
      await this._trace('keys', args, start, false, err);
      throw err;
    }
  }

  /**
   * Evaluate an expression in page context
   * @param {{ expression: string }} args
   */
  async exec(args) {
    const start = Date.now();
    const page = this._requirePage();
    try {
      const result = await page.evaluate(args.expression);
      await this._trace('exec', args, start, true);
      this._afterAction('exec', start);
      return result;
    } catch (e) {
      this._metrics.errors++;
      const err = new ScriptError('Script execution failed', { cause: e });
      await this._trace('exec', args, start, false, err);
      throw err;
    }
  }

  /**
   * Set full HTML content of the page (no navigation)
   * @param {{ html: string, timeoutMs?: number }} args
   */
  async setContent(args) {
    const start = Date.now();
    const page = this._requirePage();
    if (!args || typeof args.html !== 'string') throw new BadInputError('setContent.html must be a string');
    const timeout = args.timeoutMs ?? 15000;
    try {
      await page.setContent(args.html, { waitUntil: 'domcontentloaded', timeout });
      await this._trace('setContent', { len: args.html.length }, start, true);
      this._afterAction('setContent', start);
    } catch (e) {
      this._metrics.errors++;
      const err = toEyesError(e);
      await this._trace('setContent', { len: args.html.length }, start, false, err);
      throw err;
    }
  }

  /**
   * Screenshot current page
   * @param {{ fullPage?: boolean, format?: 'webp'|'png', quality?: number }} [args]
   * @returns {Promise<{buffer:Buffer,dataUrl:string,mime:string}>}
   */
  async screenshot(args = {}) {
    const start = Date.now();
    const page = this._requirePage();
    const type = args.format || 'webp';
    const quality = typeof args.quality === 'number' ? args.quality : (type === 'webp' ? 70 : undefined);
    const mime = type === 'png' ? 'image/png' : 'image/webp';
    const buf = await page.screenshot({ type, quality, fullPage: !!args.fullPage }).catch((e) => { throw toEyesError(e); });
    await this._trace('screenshot', args, start, true);
    this._afterAction('screenshot', start);
    return { buffer: Buffer.from(buf), dataUrl: artifacts.toDataURL(buf, mime), mime };
  }

  /** Take a screenshot and return dataURL directly */
  async screenshotDataURL(args = {}) {
    const shot = await this.screenshot(args);
    return shot.dataUrl;
  }

  /** Get last WebGL/WebGPU canvas frame as dataURL or null */
  async canvas() {
    const page = this._requirePage();
    const url = await getLastCanvasFrame(page);
    return url || null;
  }

  /**
   * Serialize DOM
   * @param {{maxDepth?:number, plaintext?:boolean}} [opts]
   */
  async dom(opts) {
    const page = this._requirePage();
    return artifacts.serializeDOM(page, opts);
  }

  /** Accessibility snapshot */
  async a11y() {
    const page = this._requirePage();
    return artifacts.a11ySnapshot(page);
  }

  /** Last console entries */
  getConsole(n = 100) { return this._console.slice(-n); }
  /** Last network entries */
  getNetwork(n = 200) { return this._network.slice(-n); }

  /** On preview frames (syntactic sugar) */
  onCanvasFrame(cb) { this.on('frame', cb); return () => this.off('frame', cb); }

  /** Lightweight metrics */
  metrics() {
    const avg = this._metrics.actions ? this._metrics.totalDurationMs / this._metrics.actions : 0;
    const errorRate = this._metrics.actions ? this._metrics.errors / this._metrics.actions : 0;
    return { actions: this._metrics.actions, avgDurationMs: Math.round(avg), errorRate };
  }

  // internal
  _requirePage() { if (!this.page) throw new InternalError('Eyes not opened'); return this.page; }

  _pushRing(arr, item, max = 1000) { arr.push(item); if (arr.length > max) arr.splice(0, arr.length - max); }

  async _microIdle() { try { await this.page?.waitForTimeout(100); } catch (_) {} }

  async _suggestSelectors(selector) {
    const page = this._requirePage();
    const suggestions = await page.evaluate((sel) => {
      try {
        const all = Array.from(document.querySelectorAll('*'))
          .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.') : ''));
        const uniq = Array.from(new Set(all));
        function distance(a, b) { // simple Levenshtein-like
          const dp = Array(a.length + 1).fill(0).map(() => Array(b.length + 1).fill(0));
          for (let i = 0; i <= a.length; i++) dp[i][0] = i;
          for (let j = 0; j <= b.length; j++) dp[0][j] = j;
          for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
          }
          return dp[a.length][b.length];
        }
        uniq.sort((a, b) => distance(sel, a) - distance(sel, b));
        return uniq.slice(0, 5);
      } catch (e) { return []; }
    }, selector);
    return suggestions || [];
  }

  _startFrameStream() {
    const page = this._requirePage();
    const fps = this.options.frameStream?.fps ?? 3; // ~2-4 fps default
    const period = Math.max(200, Math.floor(1000 / Math.min(Math.max(fps, 0.5), 8)));
    this._frameInterval = setInterval(async () => {
      if (!this.page) return;
      try {
        const type = 'webp';
        const buf = await page.screenshot({ type, quality: 60, fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' });
        this.emit('frame', Buffer.from(buf));
      } catch (_) { /* ignore transient */ }
    }, period);
  }

  /**
   * Check visual stability by sampling multiple screenshots and comparing diffs.
   * @param {{ durationMs?: number, fps?: number, threshold?: number }} [opts]
   * @returns {Promise<{stable:boolean, avgDiff:number, maxDiff:number, samples:number}>}
   */
  async visualStability(opts = {}) {
    const page = this._requirePage();
    const durationMs = Math.min(Math.max(opts.durationMs ?? 2000, 300), 15000);
    const fps = Math.min(Math.max(opts.fps ?? 3, 1), 10);
    const threshold = Math.min(Math.max(opts.threshold ?? 0.02, 0), 1);
    const period = Math.floor(1000 / fps);
    const frames = [];
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      const dataUrl = await this.screenshotDataURL({ format: 'webp', quality: 60 });
      frames.push(dataUrl);
      await page.waitForTimeout(period);
    }
    let diffs = [];
    for (let i = 1; i < frames.length; i++) {
      try {
        const ratio = await artifacts.diffDataURLs(page, frames[i - 1], frames[i], { sampleStride: 3, resizeWidth: 256 });
        diffs.push(ratio);
      } catch (_) {}
    }
    const avg = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    const max = diffs.length ? Math.max(...diffs) : 0;
    return { stable: avg <= threshold, avgDiff: Number(avg.toFixed(4)), maxDiff: Number(max.toFixed(4)), samples: diffs.length };
  }

  /**
   * Compute a DOM signature hash for quick structure comparisons.
   * @returns {Promise<{hash:string, size:number}>}
   */
  async domSignature() {
    const page = this._requirePage();
    const tree = await artifacts.serializeDOM(page, { maxDepth: 4, plaintext: true });
    const json = JSON.stringify(tree);
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha1').update(json).digest('hex');
    return { hash, size: json.length };
  }

  async _trace(event, payload, start, success, error) {
    try {
      if (!this.options.trace?.enabled) return;
      if (!this._traceStream) {
        const fs = await import('node:fs');
        const file = this.options.trace?.file || `eyes-trace-${Date.now()}.jsonl`;
        this._traceStream = fs.createWriteStream(file, { flags: 'a' });
      }
      const line = JSON.stringify({ ts: Date.now(), event, payload, durationMs: Date.now() - start, success, error: error ? { code: error.code, message: error.message, hint: error.hint } : undefined }) + '\n';
      this._traceStream.write(line);
    } catch (_) {}
  }

  _afterAction(action, start) {
    const durationMs = Date.now() - start;
    this._metrics.actions += 1;
    this._metrics.totalDurationMs += durationMs;
    this.emit('actionCompleted', { action, durationMs });
  }
}

/**
 * Helper to create an AgentEyes instance
 * @param {AgentEyesOptions} options
 */
export function createEyes(options) { return new AgentEyes(options); }

export const detectUtils = detect;
export const artifactsUtils = artifacts;
export const errorsUtils = errors;
