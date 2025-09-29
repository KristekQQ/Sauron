// Custom error types and codes for AgentEyes
// JSDoc typedefs
/**
 * @typedef {(
 *   'ELEMENT_NOT_FOUND'|
 *   'NAVIGATION_TIMEOUT'|
 *   'SCRIPT_ERROR'|
 *   'SECURITY_BLOCKED'|
 *   'RATE_LIMIT'|
 *   'BAD_INPUT'|
 *   'INTERNAL'
 * )} ErrorCode
 */

/**
 * Base error for AgentEyes
 */
export class EyesError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{hint?: string, cause?: any, data?: any}} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'EyesError';
    this.code = code;
    this.hint = opts.hint || undefined;
    this.data = opts.data || undefined;
    if (opts.cause) {
      // Attach but don't use native cause to keep Node 18 compatibility across bundlers
      this.original = opts.cause;
    }
  }
}

export class ElementNotFoundError extends EyesError {
  constructor(message, opts) { super('ELEMENT_NOT_FOUND', message, opts); this.name = 'ElementNotFoundError'; }
}
export class NavigationTimeoutError extends EyesError {
  constructor(message, opts) { super('NAVIGATION_TIMEOUT', message, opts); this.name = 'NavigationTimeoutError'; }
}
export class ScriptError extends EyesError {
  constructor(message, opts) { super('SCRIPT_ERROR', message, opts); this.name = 'ScriptError'; }
}
export class SecurityBlockedError extends EyesError {
  constructor(message, opts) { super('SECURITY_BLOCKED', message, opts); this.name = 'SecurityBlockedError'; }
}
export class RateLimitError extends EyesError {
  constructor(message, opts) { super('RATE_LIMIT', message, opts); this.name = 'RateLimitError'; }
}
export class BadInputError extends EyesError {
  constructor(message, opts) { super('BAD_INPUT', message, opts); this.name = 'BadInputError'; }
}
export class InternalError extends EyesError {
  constructor(message, opts) { super('INTERNAL', message, opts); this.name = 'InternalError'; }
}

export const errors = {
  EyesError,
  ElementNotFoundError,
  NavigationTimeoutError,
  ScriptError,
  SecurityBlockedError,
  RateLimitError,
  BadInputError,
  InternalError,
};

/**
 * Normalize unexpected errors
 * @param {any} err
 * @param {string} fallbackMsg
 * @returns {EyesError}
 */
export function toEyesError(err, fallbackMsg = 'Unexpected error') {
  if (err instanceof EyesError) return err;
  const message = err && err.message ? err.message : fallbackMsg;
  return new InternalError(message, { cause: err });
}

