import { AgentEyes } from '../src/index.js';
import { writeFile } from 'node:fs/promises';

async function main() {
  const eyes = new AgentEyes({
    headless: true,
    blockPrivateIPs: false,
    canvasHook: false,
    browserFlags: [
      '--headless=new',
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--disable-dawn-features=disallow_unsafe_apis',
    ],
    log: { level: 'info' },
  });

  await eyes.open();
  try {
    await eyes.navigate({ url: 'http://localhost:8000/', wait: 'domcontentloaded', timeoutMs: 30000 });
    await eyes.wait({ for: 'timeout', timeoutMs: 5000 });

    const dataUrl = await eyes.exec({
      expression: "(() => { const canvas = document.querySelector('canvas'); if (!canvas) return null; return canvas.toDataURL('image/png'); })()",
    });
    if (!dataUrl) throw new Error('Canvas not found – is the WebGPU scene loaded?');

    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    await writeFile('webgpu-direct.png', buffer);
    console.log('Saved WebGPU snapshot to webgpu-direct.png');
  } finally {
    await eyes.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
