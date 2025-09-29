import { SecurityBlockedError, BadInputError } from './errors.js';

// RFC1918 + localhost/private ranges
const PRIVATE_CIDRS = [
  // IPv4
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  // IPv6 localhost/link-local/unique local
  /^\[?::1\]?$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd00:/i,
  /^localhost$/i
];

/**
 * Basic URL validation
 * @param {string} url
 */
export function ensureValidUrl(url) {
  try { return new URL(url); } catch (e) { throw new BadInputError(`Invalid URL: ${url}`); }
}

/**
 * SSRF guard for navigation
 * @param {string} rawUrl
 * @param {{ allowNavigationTo?: RegExp, blockPrivateIPs?: boolean }} options
 */
export function guardNavigation(rawUrl, options = {}) {
  const u = ensureValidUrl(rawUrl);
  const { hostname, protocol } = u;
  if (!/^https?:$/.test(protocol)) {
    throw new SecurityBlockedError(`Blocked non-HTTP(S) scheme: ${protocol}`);
  }
  if (options.allowNavigationTo && !options.allowNavigationTo.test(u.toString())) {
    throw new SecurityBlockedError(`URL not allowed by allowlist: ${u.toString()}`, { data: { url: u.toString() } });
  }
  if (options.blockPrivateIPs !== false) {
    if (isPrivateHostname(hostname)) {
      throw new SecurityBlockedError(`Blocked private/loopback host: ${hostname}`, { data: { host: hostname } });
    }
  }
  return u.toString();
}

/**
 * @param {string} hostname
 */
export function isPrivateHostname(hostname) {
  const hn = hostname.replace(/^\[/, '').replace(/\]$/, ''); // strip [] around IPv6
  for (const re of PRIVATE_CIDRS) {
    if (re.test(hn)) return true;
  }
  return false;
}

