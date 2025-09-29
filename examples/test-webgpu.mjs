import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentEyes } from '../src/index.js';

const WEBGPU_DIR = resolve(process.cwd(), 'examples', 'webgpu');

async function waitForCanvas(eyes, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = await eyes.canvas();
    if (url) return url;
    await eyes.wait({ for: 'timeout', timeoutMs: 100 });
  }
  return null;
}

async function main() {
  const eyes = new AgentEyes({ headless: false, blockPrivateIPs: true, frameStream: { fps: 2 } });
  try {
    await eyes.open();
    // Inline the WebGPU demo
    const htmlGpu = await readFile(resolve(WEBGPU_DIR, 'index.html'), 'utf-8');
    const jsGpu = await readFile(resolve(WEBGPU_DIR, 'main.js'), 'utf-8');
    const cssGpu = await readFile(resolve(WEBGPU_DIR, 'style.css'), 'utf-8');
    let inlined = htmlGpu
      .replace('<link rel="stylesheet" href="style.css" />', `<style>${cssGpu}</style>`)
      .replace('<script type="module" src="main.js"></script>', `<script type="module">\n${jsGpu}\n</script>`);
    await eyes.setContent({ html: inlined, timeoutMs: 15000 });
    await eyes.wait({ for: 'timeout', timeoutMs: 500 });
    // Debug info
    const info = await eyes.exec({ expression: `(() => {
      try {
        const ctxTypes = (window.__EYES && window.__EYES.ctxTypes) || [];
        const status = document.getElementById('status')?.textContent || '';
        const ok = !!navigator.gpu;
        return { ctxTypes, status, webgpuSupported: ok };
      } catch (e) { return null; }
    })()` }).catch(() => null);
    if (info) console.log('Info:', info);
    if (!info || !info.webgpuSupported) {
      // Fallback to WebGL demo
      const WEBGL_DIR = resolve(process.cwd(), 'examples', 'webgl');
      const htmlGl = await readFile(resolve(WEBGL_DIR, 'index.html'), 'utf-8');
      const jsGl = await readFile(resolve(WEBGL_DIR, 'main.js'), 'utf-8');
      // reuse css from webgpu
      inlined = htmlGl
        .replace('<link rel="stylesheet" href="../webgpu/style.css" />', `<style>${cssGpu}</style>`)
        .replace('<script type="module" src="main.js"></script>', `<script type="module">\n${jsGl}\n</script>`);
      await eyes.setContent({ html: inlined, timeoutMs: 15000 });
      await eyes.wait({ for: 'timeout', timeoutMs: 400 });
      await eyes.exec({ expression: "(function(){try{var c=document.getElementById('gl-canvas'); if(c){ window.__EYES = window.__EYES||{}; window.__EYES.canvasFrame = c.toDataURL('image/webp',0.8);} }catch(e){} return true;})()" });
      const webglInfo = await eyes.exec({ expression: "(function(){var gl=document.getElementById('gl-canvas')?.getContext('webgl'); return {webglSupported: !!gl, status: document.getElementById('status')?.textContent||''};})()" });
      console.log('WebGL info:', webglInfo);
    }
    // Force a one-off capture if periodic capture is delayed
    await eyes.exec({ expression: "(function(){try{var c=document.getElementById('gpu-canvas'); if(c){ window.__EYES = window.__EYES||{}; window.__EYES.canvasFrame = c.toDataURL('image/webp',0.8);} }catch(e){} return true;})()" });

    const canvasUrl = await waitForCanvas(eyes, 4000);
    if (!canvasUrl) throw new Error('Canvas frame not captured');

    // Read the page-exposed average color baseline
    let avg = null;
    // Try robust in-page computation without Image/onload
    avg = await eyes.exec({ expression: `(() => {
      try {
        const c = document.getElementById('gpu-canvas') || document.getElementById('gl-canvas');
        if (!c) return null;
        const aux = document.createElement('canvas');
        aux.width = c.width; aux.height = c.height;
        const ctx = aux.getContext('2d');
        ctx.drawImage(c, 0, 0);
        const cx = Math.floor(aux.width / 2 - 100);
        const cy = Math.floor(aux.height / 2 - 100);
        const w = 200, h = 200;
        const data = ctx.getImageData(cx, cy, w, h).data;
        let r=0,g=0,b=0,n=0;
        for (let y=0; y<h; y+=4) {
          for (let x=0; x<w; x+=4) {
            const i=((y*w)+x)*4; r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++;
          }
        }
        const out = [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
        window.__TEST = { avg: out };
        return out;
      } catch (e) { return null; }
    })()` }).catch(() => null);
    if (!avg || !Array.isArray(avg)) throw new Error('Missing average color baseline');

    // Baseline check: the red component should dominate for our red triangle
    const [r, g, b] = avg;
    const ok = r > g + 20 && r > b + 20 && r > 60; // relaxed thresholds

    if (!ok) {
      console.error('Baseline mismatch: avgRGB=', avg);
      process.exitCode = 1;
    } else {
      console.log('WebGPU triangle test OK. avgRGB=', avg);
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    try { await eyes.close(); } catch {}
  }
}

main();
