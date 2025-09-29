import { BadInputError, ElementNotFoundError, toEyesError } from './errors.js';

/**
 * EyesRunner: orchestrate sequential steps with retries and backoff
 */
export class EyesRunner {
  /**
   * @param {import('./agent-eyes.js').AgentEyes} eyes
   */
  constructor(eyes) { this.eyes = eyes; }

  /**
   * @typedef {{ action: 'navigate'|'click'|'type'|'wait'|'scroll'|'keys'|'exec', args: any }} Step
   */
  /**
   * @param {{ goal: string, steps: Step[], abortOnError?: boolean, maxDurationMs?: number }} plan
   * @returns {Promise<{ success: boolean, traceId: string, lastState: any, artifacts: { screenshot?: any, domSnippet?: any }, error?: any }>}
   */
  async run(plan) {
    if (!plan || !Array.isArray(plan.steps)) throw new BadInputError('Runner requires steps[]');
    const maxSteps = 50;
    if (plan.steps.length > maxSteps) throw new BadInputError(`Too many steps (>${maxSteps})`);
    const started = Date.now();
    const traceId = `eyes-run-${started}-${Math.random().toString(36).slice(2, 8)}`;

    /** @type {any} */
    let lastError = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      try {
        await this._execute(step);
      } catch (e) {
        lastError = e;
        if (plan.abortOnError !== false) break;
      }
      if (plan.maxDurationMs && Date.now() - started > plan.maxDurationMs) break;
    }

    const eyes = this.eyes;
    const screenshot = await eyes.screenshot({ format: 'webp', quality: 60 }).catch(() => null);
    const domSnippet = await eyes.dom({ maxDepth: 3, plaintext: true }).catch(() => null);
    const lastState = await eyes.state().catch(() => ({}));
    const success = !lastError;
    return { success, traceId, lastState, artifacts: { screenshot, domSnippet }, error: lastError ? this._errorInfo(lastError) : undefined };
  }

  async _execute(step) {
    const eyes = this.eyes;
    const action = step.action;
    const args = step.args || {};
    const fragile = action === 'click' || (action === 'wait' && args.for === 'selector');
    const attempts = fragile ? 3 : 1;

    for (let i = 0; i < attempts; i++) {
      try {
        await this._dispatch(action, args);
        return;
      } catch (e) {
        const err = toEyesError(e);
        const isLast = i === attempts - 1;
        if (!isLast) {
          const backoff = Math.min(2000, 300 * Math.pow(2, i)) + Math.floor(Math.random() * 100);
          await eyes.wait({ for: 'timeout', timeoutMs: backoff });
          continue;
        }
        throw err;
      }
    }
  }

  async _dispatch(action, args) {
    const eyes = this.eyes;
    switch (action) {
      case 'navigate': return eyes.navigate(args);
      case 'click': return eyes.click(args);
      case 'type': return eyes.type(args);
      case 'wait': return eyes.wait(args);
      case 'scroll': return eyes.scroll(args);
      case 'keys': return eyes.keys(args);
      case 'exec': return eyes.exec(args);
      default: throw new BadInputError(`Unknown action: ${action}`);
    }
  }

  _errorInfo(err) {
    return { code: err.code || 'INTERNAL', message: err.message, hint: err.hint };
  }
}

