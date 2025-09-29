// Artifacts and serialization helpers

/**
 * Build a data URL from a buffer and mime
 * @param {Uint8Array|Buffer} buffer
 * @param {string} mime
 */
export function toDataURL(buffer, mime) {
  const b64 = Buffer.from(buffer).toString('base64');
  return `data:${mime};base64,${b64}`;
}

/**
 * Serialize a DOM tree with maxDepth
 * @param {import('playwright').Page} page
 * @param {{maxDepth?:number, plaintext?:boolean}} [opts]
 */
export async function serializeDOM(page, opts = {}) {
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? 4, 1), 10);
  const plaintext = !!opts.plaintext;
  return await page.evaluate(({ maxDepth, plaintext }) => {
    function attrs(node) {
      const o = {};
      if (node.attributes) {
        for (const a of Array.from(node.attributes)) {
          if (a.name && a.value != null) o[a.name] = a.value;
        }
      }
      return o;
    }
    function nodeInfo(n, depth) {
      if (!n || depth > maxDepth) return null;
      const info = { tag: n.nodeType === 1 ? n.tagName.toLowerCase() : n.nodeName, attrs: {}, children: [] };
      if (n.nodeType === 1) info.attrs = attrs(n);
      if (plaintext && n.nodeType === 1) {
        const txt = /** @type {HTMLElement} */(n).innerText || '';
        info.text = txt.slice(0, 2000);
      } else if (!plaintext && n.nodeType === 3) {
        info.text = (n.nodeValue || '').slice(0, 2000);
      }
      if (n.childNodes && depth < maxDepth) {
        for (const c of Array.from(n.childNodes)) {
          const ci = nodeInfo(c, depth + 1);
          if (ci) info.children.push(ci);
          if (info.children.length > 1000) break;
        }
      }
      return info;
    }
    return nodeInfo(document.documentElement, 1);
  }, { maxDepth, plaintext });
}

/**
 * Accessibility snapshot helper
 * @param {import('playwright').Page} page
 */
export async function a11ySnapshot(page) {
  try {
    // @ts-ignore - ESM JS only
    const snap = await page.accessibility().snapshot({ interestingOnly: false });
    return snap;
  } catch (e) {
    return null;
  }
}

export const artifacts = {
  toDataURL,
  serializeDOM,
  a11ySnapshot,
};

/**
 * Compute simple diff ratio (0..1) between two image dataURLs by drawing to a canvas in the page.
 * Uses sampling stride for speed.
 * @param {import('playwright').Page} page
 * @param {string} dataUrlA
 * @param {string} dataUrlB
 * @param {{sampleStride?: number, resizeWidth?: number}} [opts]
 * @returns {Promise<number>} ratio of changed pixels (approx.)
 */
export async function diffDataURLs(page, dataUrlA, dataUrlB, opts = {}) {
  const sampleStride = Math.max(1, Math.floor(opts.sampleStride ?? 2));
  const resizeWidth = Math.max(32, Math.floor(opts.resizeWidth ?? 256));
  const ratio = await page.evaluate(({ a, b, sampleStride, resizeWidth }) => new Promise((resolve) => {
    try {
      const imgA = new Image(); const imgB = new Image();
      let ready = 0;
      const done = () => {
        if (++ready < 2) return;
        const w = resizeWidth;
        const h = Math.max(32, Math.floor(imgA.height * (w / imgA.width)));
        const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
        const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
        const g1 = c1.getContext('2d'); const g2 = c2.getContext('2d');
        g1.drawImage(imgA, 0, 0, w, h);
        g2.drawImage(imgB, 0, 0, w, h);
        const d1 = g1.getImageData(0, 0, w, h).data;
        const d2 = g2.getImageData(0, 0, w, h).data;
        let diff = 0; let total = 0;
        for (let y = 0; y < h; y += sampleStride) {
          for (let x = 0; x < w; x += sampleStride) {
            const i = (y * w + x) * 4;
            const dr = d1[i] - d2[i];
            const dg = d1[i+1] - d2[i+1];
            const db = d1[i+2] - d2[i+2];
            const delta = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
            if (delta > 30) diff++;
            total++;
          }
        }
        resolve(total ? diff / total : 0);
      };
      imgA.onload = done; imgB.onload = done;
      imgA.src = a; imgB.src = b;
    } catch (e) { resolve(1); }
  }), { a: dataUrlA, b: dataUrlB, sampleStride, resizeWidth });
  return Number.isFinite(ratio) ? ratio : 1;
}

/**
 * Compute 8x8 average-hash (aHash) of an image dataURL. Returns 16-char hex string.
 * @param {import('playwright').Page} page
 * @param {string} dataUrl
 */
export async function aHashDataURL(page, dataUrl) {
  const hash = await page.evaluate((url) => new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const w = 8, h = 8;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const gray = new Array(w * h);
        let sum = 0;
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const gr = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          gray[j] = gr; sum += gr;
        }
        const avg = sum / (w * h);
        let bits = '';
        for (let k = 0; k < gray.length; k++) bits += gray[k] >= avg ? '1' : '0';
        // Convert to hex
        let hex = '';
        for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
        resolve(hex);
      };
      img.src = url;
    } catch (e) { resolve(null); }
  }), dataUrl);
  return hash || null;
}

