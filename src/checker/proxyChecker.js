/**
 * proxyChecker.js
 *
 * Pure proxy healthcheck logic - no database dependency.
 * Extracted and adapted from ui-management/backend/handlers/proxyHandlers.js
 *
 * Supports: HTTP and SOCKS5 proxies, IPv4 and IPv6 exit IPs.
 * Checks by routing an HTTPS request through the proxy and comparing the returned
 * exit IP against the expected IP. No expected IP = just tests reachability.
 */

'use strict';

const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const IP_CHECK_URL_IPV4 = 'https://api.ipify.org';
const IP_CHECK_URL_IPV6 = 'https://api64.ipify.org';

/**
 * Get configured timeout in milliseconds.
 * Reads PROXY_HEALTHCHECK_TIMEOUT_SECONDS from env, defaults to 3s.
 */
function getTimeoutMs() {
  const sec = process.env.PROXY_HEALTHCHECK_TIMEOUT_SECONDS;
  if (sec) {
    const n = parseInt(sec, 10);
    if (!isNaN(n) && n > 0) return n * 1000;
  }
  return 3000;
}

/**
 * Wrap IPv6 addresses in brackets for URL construction.
 * e.g. "2001:db8::1" → "[2001:db8::1]"
 */
function formatHost(host) {
  if (!host) return host;
  const h = host.trim();
  return h.includes(':') ? `[${h}]` : h;
}

/**
 * Make an HTTPS GET request through the given agent and return the response body.
 * Rejects on network error or timeout.
 */
function fetchViaProxy(agent, checkUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(checkUrl, { agent, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body.trim()));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * Return true if value is a valid IPv4 address.
 */
function isValidIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^[0-9]+$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255 && String(n) === String(Number(part));
  });
}

/**
 * Return true if value is a valid IPv6 address (simplified check).
 * Accepts compressed forms like \"2001:db8::1\".
 */
function isValidIPv6(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  // must contain at least one colon and only hex, colon, or dot characters
  if (!v.includes(':')) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(v)) return false;
  return true;
}

/**
 * Check a single proxy.
 *
 * @param {object} opts
 * @param {string}  opts.host        - Proxy server host or IP
 * @param {number}  opts.port        - Proxy server port
 * @param {string}  [opts.username]  - Proxy auth username
 * @param {string}  [opts.password]  - Proxy auth password
 * @param {string}  [opts.proxyType] - 'http' | 'socks5' (default: 'http')
 * @param {string}  [opts.expectedIP]- Expected exit IP. If omitted, any response = online.
 * @param {boolean} [opts.isIPv6]    - Use IPv6 check URL (default: false)
 *
 * @returns {Promise<{
 *   online: boolean,
 *   exitIP: string|null,
 *   latencyMs: number,
 *   error?: string
 * }>}
 */
async function checkProxy({
  host,
  port,
  username = '',
  password = '',
  proxyType = 'http',
  expectedIP,
  isIPv6 = false,
}) {
  const timeoutMs = getTimeoutMs();
  const checkUrl = isIPv6 ? IP_CHECK_URL_IPV6 : IP_CHECK_URL_IPV4;
  const auth =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';
  const hostForUrl = formatHost(host);
  const type = (proxyType || 'http').toLowerCase();

  const proxyUrl =
    type === 'socks5'
      ? `socks5://${auth}${hostForUrl}:${port}`
      : `http://${auth}${hostForUrl}:${port}`;

  const agent =
    type === 'socks5'
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);

  const start = Date.now();
  try {
    const exitIP = await fetchViaProxy(agent, checkUrl, timeoutMs);
    const latencyMs = Date.now() - start;
    const validIp = isValidIPv4(exitIP) || isValidIPv6(exitIP);
    if (!validIp) {
      return {
        online: false,
        exitIP,
        latencyMs,
        error: 'Non-IP response from proxy',
      };
    }
    const hasExpected =
      expectedIP &&
      expectedIP.trim() !== '' &&
      expectedIP.trim() !== 'N/A';
    const online = hasExpected
      ? exitIP === expectedIP.trim()
      : exitIP.length > 0;
    return { online, exitIP, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { online: false, exitIP: null, latencyMs, error: err.message };
  }
}

/**
 * Validate and normalise a proxy input object from a request body.
 * Returns { valid: true, proxy } or { valid: false, message }.
 */
function validateProxy(input) {
  const { host, port, username, password, proxyType, expectedIP, isIPv6 } = input || {};
  if (!host || typeof host !== 'string' || !host.trim()) {
    return { valid: false, message: '"host" is required' };
  }
  const portNum = parseInt(port, 10);
  if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { valid: false, message: '"port" must be an integer between 1 and 65535' };
  }
  const type = proxyType ? proxyType.toLowerCase() : 'http';
  if (type !== 'http' && type !== 'socks5') {
    return { valid: false, message: '"proxyType" must be "http" or "socks5"' };
  }
  return {
    valid: true,
    proxy: {
      host: host.trim(),
      port: portNum,
      username: username || '',
      password: password || '',
      proxyType: type,
      expectedIP: expectedIP || null,
      isIPv6: Boolean(isIPv6),
    },
  };
}

module.exports = { checkProxy, validateProxy };
