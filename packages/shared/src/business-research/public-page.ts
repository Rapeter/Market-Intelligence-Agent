import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';

export type PublicPageErrorCode =
  | 'INVALID_URL'
  | 'NON_PUBLIC_ADDRESS'
  | 'DNS_FAILED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNSAFE_REDIRECT'
  | 'REDIRECT_LIMIT'
  | 'HTTP_ERROR'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_CONTENT_ENCODING'
  | 'RESPONSE_TOO_LARGE';

export class PublicPageError extends Error {
  readonly code: PublicPageErrorCode;

  constructor(code: PublicPageErrorCode) {
    super(publicPageErrorMessage(code));
    this.name = 'PublicPageError';
    this.code = code;
  }
}

export interface PublicPageRequest {
  url: URL;
  address: string;
  signal: AbortSignal;
  maxBytes: number;
}

export interface PublicPageResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

export interface PublicPageContent {
  finalUrl: string;
  text: string;
  contentType: string;
}

export interface PublicPageReader {
  read(url: string, signal: AbortSignal): Promise<PublicPageContent>;
}

export interface PublicPageReaderOptions {
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  request?: (input: PublicPageRequest) => Promise<PublicPageResponse>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(address, prefix, 'ipv4');
}

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const) {
  blockedV6.addSubnet(address, prefix, 'ipv6');
}

/** Conservative global-unicast check; special-use and documentation ranges are denied. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
  return false;
}

/** Reads text from a public HTTPS page without following redirects or executing page content. */
export function createPublicPageReader(options: PublicPageReaderOptions = {}): PublicPageReader {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const request = options.request ?? requestPinnedHttps;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
  const maxRedirects = options.maxRedirects ?? 4;

  return {
    async read(rawUrl, callerSignal) {
      if (
        !Number.isInteger(timeoutMs) || timeoutMs < 1 ||
        !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 ||
        !Number.isInteger(maxRedirects) || maxRedirects < 0
      ) {
        throw new PublicPageError('INVALID_URL');
      }

      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        let current = parseHttpsUrl(rawUrl);
        for (let redirectCount = 0; ; ) {
          throwIfAborted(controller.signal, timedOut);
          const addresses = await awaitAbortable(resolveAddresses(current.hostname, resolveHost), controller.signal);
          if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
            throw new PublicPageError('NON_PUBLIC_ADDRESS');
          }
          const response = await awaitAbortable(
            request({ url: current, address: addresses[0]!, signal: controller.signal, maxBytes: maxResponseBytes }),
            controller.signal,
          );
          if (response.body.byteLength > maxResponseBytes) throw new PublicPageError('RESPONSE_TOO_LARGE');

          if (isRedirect(response.status)) {
            const location = response.headers.location;
            if (location === undefined || location.trim().length === 0) throw new PublicPageError('UNSAFE_REDIRECT');
            if (redirectCount >= maxRedirects) throw new PublicPageError('REDIRECT_LIMIT');
            try {
              current = parseHttpsUrl(new URL(location, current).href);
            } catch (error) {
              if (error instanceof PublicPageError) throw error;
              throw new PublicPageError('UNSAFE_REDIRECT');
            }
            redirectCount += 1;
            continue;
          }
          if (response.status < 200 || response.status >= 300) throw new PublicPageError('HTTP_ERROR');

          const contentType = (response.headers['content-type'] ?? '').split(';', 1)[0]!.trim().toLowerCase();
          if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType)) {
            throw new PublicPageError('UNSUPPORTED_CONTENT_TYPE');
          }
          const contentEncoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
          if (contentEncoding !== '' && contentEncoding !== 'identity') {
            throw new PublicPageError('UNSUPPORTED_CONTENT_ENCODING');
          }

          const rawText = new TextDecoder('utf-8', { fatal: false }).decode(response.body);
          return {
            finalUrl: current.href,
            text: htmlToPlainText(rawText),
            contentType,
          };
        }
      } catch (error) {
        if (timedOut) throw new PublicPageError('TIMEOUT');
        if (callerSignal.aborted) throw new PublicPageError('CANCELLED');
        if (error instanceof PublicPageError) throw error;
        throw new PublicPageError('NETWORK_ERROR');
      } finally {
        clearTimeout(timer);
        callerSignal.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}

function parseHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicPageError('INVALID_URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.port.length > 0 && url.port !== '443') ||
    url.hostname.length === 0
  ) {
    throw new PublicPageError('INVALID_URL');
  }
  return url;
}

async function resolveAddresses(
  hostname: string,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<readonly string[]> {
  const family = isIP(hostname);
  if (family !== 0) return [hostname];
  try {
    return await resolveHost(hostname);
  } catch {
    throw new PublicPageError('DNS_FAILED');
  }
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
}

async function requestPinnedHttps(input: PublicPageRequest): Promise<PublicPageResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const lookup = ((
      _hostname: string,
      _options: unknown,
      callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ) => callback(null, input.address, isIP(input.address))) as unknown as NonNullable<HttpsRequestOptions['lookup']>;
    const request = httpsRequest(input.url, {
      method: 'GET',
      agent: false,
      signal: input.signal,
      maxHeaderSize: 64 * 1024,
      headers: {
        accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
        'accept-encoding': 'identity',
        'user-agent': 'MarketIntelligenceAgent/0.1',
      },
      lookup,
    }, (response) => {
      const headers: Record<string, string | undefined> = {};
      for (const name of ['location', 'content-type', 'content-encoding', 'content-length']) {
        const value = response.headers[name];
        headers[name] = Array.isArray(value) ? value.join(', ') : value;
      }
      const contentLength = Number(headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
        response.destroy();
        finish(() => reject(new PublicPageError('RESPONSE_TOO_LARGE')));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer | string) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        size += bytes.byteLength;
        if (size > input.maxBytes) {
          response.destroy();
          finish(() => reject(new PublicPageError('RESPONSE_TOO_LARGE')));
          return;
        }
        chunks.push(bytes);
      });
      response.once('error', (error) => finish(() => reject(error)));
      response.once('end', () => finish(() => resolve({
        status: response.statusCode ?? 0,
        headers,
        body: Buffer.concat(chunks),
      })));
    });
    request.once('error', (error) => finish(() => reject(error)));
    request.end();
  });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function throwIfAborted(signal: AbortSignal, timedOut: boolean): void {
  if (timedOut) throw new PublicPageError('TIMEOUT');
  if (signal.aborted) throw new PublicPageError('CANCELLED');
}

function awaitAbortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new PublicPageError('CANCELLED'));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(new PublicPageError('CANCELLED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function htmlToPlainText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<(script|style|noscript|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/giu, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote)\s*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity: string) => {
      switch (entity.toLowerCase()) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'nbsp': return ' ';
        default: {
          const numeric = entity.startsWith('#x') || entity.startsWith('#X')
            ? Number.parseInt(entity.slice(2), 16)
            : entity.startsWith('#')
              ? Number.parseInt(entity.slice(1), 10)
              : Number.NaN;
          if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff)) return match;
          return String.fromCodePoint(numeric);
        }
      }
    })
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4_000)
    .trimEnd();
}

function publicPageErrorMessage(code: PublicPageErrorCode): string {
  switch (code) {
    case 'INVALID_URL': return 'The source URL is not an allowed HTTPS address.';
    case 'NON_PUBLIC_ADDRESS': return 'The source address does not resolve exclusively to public IP addresses.';
    case 'DNS_FAILED': return 'The source hostname could not be resolved.';
    case 'NETWORK_ERROR': return 'The source could not be read safely.';
    case 'TIMEOUT': return 'The source request exceeded its time budget.';
    case 'CANCELLED': return 'The source request was cancelled.';
    case 'UNSAFE_REDIRECT': return 'The source redirected to an invalid address.';
    case 'REDIRECT_LIMIT': return 'The source exceeded the redirect limit.';
    case 'HTTP_ERROR': return 'The source returned an unsuccessful response.';
    case 'UNSUPPORTED_CONTENT_TYPE': return 'The source did not return readable text content.';
    case 'UNSUPPORTED_CONTENT_ENCODING': return 'The source used an unsupported content encoding.';
    case 'RESPONSE_TOO_LARGE': return 'The source exceeded the response-size budget.';
  }
}
