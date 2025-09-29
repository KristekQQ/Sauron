// Utilities to inject canvas/WebGL/WebGPU hooks and detect graphics contexts

/**
 * Inject a script to hook HTMLCanvasElement.getContext and capture frames
 * Saved to window.__EYES.canvasFrame as dataURL (webp) about every 1s
 * Also stores flags: window.__EYES.ctxTypes, lastCanvas
 * @param {import('playwright').Page} page
 */
export async function injectCanvasHook(page) {
  const installer = () => {
    try {
      const w = window;
      if (!w.__EYES) w.__EYES = {};
      const targetTypes = new Set(['webgl', 'webgl2', 'gpupresent', 'webgpu']);
      const orig = HTMLCanvasElement.prototype.getContext;
      if (!orig || w.__EYES.__canvasHookInstalled) return;
      w.__EYES.__canvasHookInstalled = true;
      const ctxTypes = new Set();
      Object.defineProperty(w.__EYES, 'ctxTypes', { get: () => Array.from(ctxTypes) });
      let lastCanvas = null;
      Object.defineProperty(w.__EYES, 'lastCanvas', { get: () => lastCanvas });

      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        const ctx = orig.call(this, type, attrs);
        try {
          if (ctx && typeof type === 'string' && targetTypes.has(type)) {
            ctxTypes.add(type);
            lastCanvas = this;
          }
        } catch (e) {}
        return ctx;
      };

      const capture = () => {
        try {
          if (lastCanvas && typeof lastCanvas.toDataURL === 'function') {
            const url = lastCanvas.toDataURL('image/webp', 0.8);
            w.__EYES.canvasFrame = url;
          }
        } catch (e) {}
      };
      setInterval(capture, 1000);
    } catch (e) {
      // ignore
    }
  };
  await page.addInitScript(installer);
  try { await page.evaluate(installer); } catch (_) {}
}

/**
 * Get last captured canvas frame dataURL or null
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
export async function getLastCanvasFrame(page) {
  try {
    return /** @type {any} */ (await page.evaluate(() => {
      try { return window.__EYES && window.__EYES.canvasFrame || null; } catch (e) { return null; }
    }));
  } catch (e) {
    return null;
  }
}

/**
 * Detect whether page likely uses WebGL/WebGPU
 * @param {import('playwright').Page} page
 * @returns {Promise<{hasCanvas:boolean, ctxTypes:string[]}>}
 */
export async function detectCanvasAndTypes(page) {
  const res = await page.evaluate(() => {
    const w = window;
    const types = (w.__EYES && w.__EYES.ctxTypes) ? w.__EYES.ctxTypes : [];
    const has = !!(w.__EYES && w.__EYES.lastCanvas);
    return { hasCanvas: has, ctxTypes: types };
  }).catch(() => ({ hasCanvas: false, ctxTypes: [] }));
  return res;
}

export const detect = {
  injectCanvasHook,
  getLastCanvasFrame,
  detectCanvasAndTypes,
};
