const fallbackDevServerUrl = 'http://127.0.0.1:5173';

/** Accept only loopback HTTP origins for the development renderer. */
export function getDevServerUrl(value?: string): string {
  const candidate = value ?? fallbackDevServerUrl;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error('FINAGENT_DEV_SERVER_URL must be a valid loopback HTTP URL.');
  }

  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('FINAGENT_DEV_SERVER_URL must use HTTP on a loopback host.');
  }

  return url.href;
}
