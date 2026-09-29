import { describe, expect, it } from 'bun:test';
import { getDevServerUrl } from './devServerUrl.ts';

describe('getDevServerUrl', () => {
  it('uses the default local Vite URL when no URL is configured', () => {
    expect(getDevServerUrl()).toBe('http://127.0.0.1:5173/');
  });

  it('accepts the dynamically selected loopback URL', () => {
    expect(getDevServerUrl('http://127.0.0.1:43127')).toBe('http://127.0.0.1:43127/');
  });

  it('rejects remote hosts and non-HTTP URLs before loading the renderer', () => {
    expect(() => getDevServerUrl('https://127.0.0.1:43127')).toThrow(/loopback host/);
    expect(() => getDevServerUrl('http://example.com')).toThrow(/loopback host/);
    expect(() => getDevServerUrl('http://user@127.0.0.1:43127')).toThrow(/loopback host/);
  });
});
