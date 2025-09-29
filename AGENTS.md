# AGENTS.md — Guidelines for Agents

This file applies to the entire repository. The goal is to keep the “Eyes for Agents” library consistent, safe, and easy to extend.

Communication preference
- When interacting with the project owner/requester, respond in Czech. All code, comments, and docs remain in English.

Basics
- Language: plain JavaScript (ESM), no TypeScript.
- Types: JSDoc within code.
- Distribution: ESM only (`"type":"module"`), public exports via `src/index.js`.
- Node version: >= 18.
- Dependencies: `playwright`, `zod`, `eventemitter3`, `pino`.
- One instance = one session: no global browser/context singletons.

Code layout
- `src/agent-eyes.js`: core `AgentEyes` (browser mgmt, actions, events, streams).
- `src/runner.js`: `EyesRunner` (step orchestrator with retries/backoff).
- `src/detectors.js`: Canvas/WebGL/WebGPU hooks and detection utilities.
- `src/artifacts.js`: screenshots, DOM serialization, a11y snapshot.
- `src/security.js`: SSRF guard and allowlist for navigation.
- `src/errors.js`: custom errors with codes and hints.
- `src/index.js`: public exports (ESM).

If you add modules, export them explicitly from `src/index.js`.

Style and principles
- Deterministic API: all actions have reasonable default `timeoutMs`.
- Stabilize before interactions/screenshots (scrollIntoView, short idle).
- Logging via `pino` (respect `log.level`, including `silent`).
- Validate inputs with `zod`; on failure throw `BadInputError`.
- Protect network/URLs via `guardNavigation` (SSRF + allowlist). Do not navigate to private IPs unless explicitly allowed.
- Events `frame`, `console`, `network`, `navigated`, `actionCompleted` are stable; do not change payload shape without strong reason.

Security
- Block RFC1918 and localhost (IPv4/IPv6) when `blockPrivateIPs: true`.
- Allow only http/https schemes.
- `allowNavigationTo` (RegExp) serves as an allowlist. If set, URLs must match.

Reduce flakiness
- Use `locator.waitFor({ state: 'visible' })` and `scrollIntoViewIfNeeded()` before interactions.
- Retry policy for fragile actions (click/selector) in `EyesRunner`: 3 attempts, exponential backoff + jitter.

Testing and examples
- Quick smoke: `node examples/basic.mjs`.
- Orchestrator: `node examples/orchestrate.mjs`.
- Avoid adding a global test runner; keep examples small and focused.

Publishing
- `package.json` has `exports: "./src/index.js"` and `type: "module"`.
- Do not add license headers to files (global LICENSE is at repo root).
