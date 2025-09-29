import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { AgentEyes } from '../src/index.js';

const WEBGPU_DIR = resolve(process.cwd(), 'examples', 'webgpu');
const PORT = 4570;

function mimeFor(path) {
  const ext = extname(path);
  return (
    ext === '.html' ? 'text/html' :
    ext === '.js' ? 'application/javascript' :
    ext === '.css' ? 'text/css' :
    'application/octet-stream'
  );
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let filePath = WEBGPU_DIR;
      if (url.pathname === '/' || url.pathname === '') filePath = join(WEBGPU_DIR, 'index.html');
      else filePath = join(WEBGPU_DIR, url.pathname);
      await stat(filePath);
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': mimeFor(filePath) });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end('Not Found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForCanvas(eyes, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = await eyes.canvas();
    if (url) return url;
    await eyes.wait({ for: 'timeout', timeoutMs: 100 });
  }
  return null;
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${PORT}/`;

  // Headful + flags recommended for WebGPU
  const eyes = new AgentEyes({
    headless: false,
    blockPrivateIPs: false,
    browserChannel: 'chrome',
    browserFlags: ['--enable-features=Vulkan,UseSkiaRenderer'],
    frameStream: { fps: 2 }
  });
  try {
    await eyes.open();
    await eyes.navigate({ url: base, wait: 'domcontentloaded', timeoutMs: 20000 });
    await eyes.wait({ for: 'timeout', timeoutMs: 800 });

    // Check WebGPU availability
    const info = await eyes.exec({ expression: `({ ok: !!navigator.gpu, status: document.getElementById('status')?.textContent || '' })` });
    console.log('WebGPU support:', info);

    const canvasUrl = await waitForCanvas(eyes, 6000);
    if (!canvasUrl) console.warn('Warning: Canvas hook did not capture frame; will use page screenshot for baseline.');

    // Validate visual baseline (red dominance)
    const shotUrl = await eyes.screenshotDataURL({ format: 'png' });
    await eyes.exec({ expression: `window.__SHOT = ${JSON.stringify(shotUrl)}` });
    const avg = await eyes.exec({ expression: `(() => new Promise((resolve)=>{ try{ const url=window.__SHOT; if(!url) return resolve(null); const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const g=c.getContext('2d'); g.drawImage(img,0,0); const w=200,h=200; const cx=Math.floor(c.width/2-100), cy=Math.floor(c.height/2-100); const data=g.getImageData(cx,cy,w,h).data; let r=0,gc=0,b=0,n=0; for(let y=0;y<h;y+=4){ for(let x=0;x<w;x+=4){ const i=((y*w)+x)*4; r+=data[i]; gc+=data[i+1]; b+=data[i+2]; n++; }} resolve([Math.round(r/n), Math.round(gc/n), Math.round(b/n)]); }; img.src=url; }catch(e){ resolve(null); } }))()` });
    if (!avg) throw new Error('Missing avg color');
    const [r,g,b] = avg;
    const ok = r > g + 20 && r > b + 20 && r > 60;
    if (!ok) { console.error('Baseline mismatch (WebGPU):', avg); process.exitCode = 1; }
    else console.log('WebGPU triangle test OK. avgRGB=', avg);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    try { await eyes.close(); } catch {}
    server.close();
  }
}

main();
