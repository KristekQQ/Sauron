import { AgentEyes, EyesRunner } from '../src/index.js';

async function main() {
  const eyes = new AgentEyes({ headless: true });
  await eyes.open();
  const runner = new EyesRunner(eyes);
  const result = await runner.run({
    goal: 'Open a site and interact',
    steps: [
      { action: 'navigate', args: { url: 'https://example.com', wait: 'domcontentloaded' } },
      { action: 'wait', args: { for: 'selector', selector: 'h1', timeoutMs: 5000 } },
      { action: 'scroll', args: { y: 800 } },
      { action: 'wait', args: { for: 'timeout', timeoutMs: 500 } }
    ],
    abortOnError: true,
    maxDurationMs: 60000,
  });
  console.log('Run result:', result.success, result.lastState);
  await eyes.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

