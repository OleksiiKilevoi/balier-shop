import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, withHeaders } from './securityHeaders';

describe('withHeaders / applySecurityHeaders', () => {
  it('sets headers on a response whose own headers are immutable', async () => {
    // Response.redirect's headers are immutable, like a cache hit's.
    const immutable = Response.redirect('https://balier.com.ua/', 301);
    expect(() => immutable.headers.set('x-test', '1')).toThrow();

    const secured = applySecurityHeaders(immutable, 'self');
    expect(secured.status).toBe(301);
    expect(secured.headers.get('location')).toBe('https://balier.com.ua/');
    expect(secured.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");

    const tagged = withHeaders(new Response('{"a":1}', { status: 200 }), { 'x-robots-tag': 'noindex' });
    expect(tagged.headers.get('x-robots-tag')).toBe('noindex');
    expect(await tagged.text()).toBe('{"a":1}');
  });
});
