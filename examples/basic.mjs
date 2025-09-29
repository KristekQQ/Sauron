import { AgentEyes } from '../src/index.js';

async function main() {
  const eyes = new AgentEyes({ headless: true, blockPrivateIPs: true, log: { level: 'info' } });
  await eyes.open();
  eyes.on('frame', (buf) => {
    // preview frames ~2-4fps
  });
  await eyes.navigate({ url: 'https://example.com', wait: 'domcontentloaded' });
  console.log('State:', await eyes.state());
  const shot = await eyes.screenshot({ format: 'webp', quality: 70 });
  console.log('Shot mime:', shot.mime, 'size:', shot.buffer.length);
  await eyes.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

