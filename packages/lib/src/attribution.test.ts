import { describe, expect, it } from 'vitest';
import { attributionChannel, attributionDetails, nextAttribution, type Attribution, attributionEventProps } from './attribution';
import { attributionSchema } from './validation/checkout';

const now = new Date('2026-10-10T10:00:00Z');
const visit = (overrides: Partial<Parameters<typeof nextAttribution>[1]> = {}) => ({
  search: '',
  referrer: '',
  path: '/',
  ownHost: 'balier.com.ua',
  now,
  ...overrides,
});
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('nextAttribution', () => {
  it('records UTM tags, the referrer host and the landing path', () => {
    expect(
      nextAttribution(
        null,
        visit({
          search: '?utm_source=ig&utm_medium=social&utm_campaign=bio',
          referrer: 'https://l.instagram.com/?u=https%3A%2F%2Fbalier.com.ua',
          path: '/products/shoper',
        }),
      ),
    ).toEqual({
      source: 'ig',
      medium: 'social',
      campaign: 'bio',
      referrer: 'l.instagram.com',
      landing: '/products/shoper',
      at: now.toISOString(),
    });
  });

  it('keeps the host only, never the referrer path or query', () => {
    const result = nextAttribution(null, visit({ referrer: 'https://www.google.com/search?q=my+name' }));
    expect(result?.referrer).toBe('www.google.com');
    expect(JSON.stringify(result)).not.toContain('my+name');
  });

  it('reads the app id an Android app reports as its referrer', () => {
    expect(nextAttribution(null, visit({ referrer: 'android-app://org.telegram.messenger/' }))?.referrer).toBe(
      'org.telegram.messenger',
    );
  });

  it('lets a later direct visit keep the earlier source', () => {
    const stored: Attribution = { source: 'ig', landing: '/', at: daysAgo(1) };
    expect(nextAttribution(stored, visit())).toBe(stored);
  });

  it('lets a later tagged visit replace the earlier source', () => {
    const stored: Attribution = { source: 'ig', landing: '/', at: daysAgo(1) };
    expect(nextAttribution(stored, visit({ search: '?utm_source=threads' }))?.source).toBe('threads');
  });

  it('ignores the way back from the bank and clicks inside the shop', () => {
    const stored: Attribution = { source: 'ig', landing: '/', at: daysAgo(1) };
    expect(nextAttribution(stored, visit({ referrer: 'https://pay.monobank.ua/abc' }))).toBe(stored);
    expect(nextAttribution(stored, visit({ referrer: 'https://balier.com.ua/products' }))).toBe(stored);
  });

  it('starts a direct visit when nothing is stored', () => {
    expect(nextAttribution(null, visit({ path: '/products' }))).toEqual({ landing: '/products', at: now.toISOString() });
  });

  it('replaces a source older than 30 days with a direct visit', () => {
    const stored: Attribution = { source: 'ig', landing: '/', at: daysAgo(31) };
    expect(nextAttribution(stored, visit())).toEqual({ landing: '/', at: now.toISOString() });
  });
});

describe('attributionChannel', () => {
  it.each([
    [{ source: 'ig' }, 'Instagram'],
    [{ referrer: 'l.instagram.com' }, 'Instagram'],
    [{ referrer: 'www.google.com' }, 'Google'],
    [{ referrer: 'com.google.android.googlequicksearchbox' }, 'Google'],
    [{ referrer: 'org.telegram.messenger' }, 'Telegram'],
    [{ source: 'threads' }, 'Threads'],
    [{ referrer: 'www.work.ua' }, 'www.work.ua'],
    [{ landing: '/' }, 'Прямий захід'],
  ] as [Attribution, string][])('%o → %s', (attribution, channel) => {
    expect(attributionChannel(attribution)).toBe(channel);
  });

  it('says unknown for orders from before tracking', () => {
    expect(attributionChannel(null)).toBe('Невідомо');
  });
});

describe('attributionSchema', () => {
  it('drops unknown keys and rejects overlong values', () => {
    expect(attributionSchema.parse({ source: 'ig', email: 'x@y.z' })).toEqual({ source: 'ig' });
    expect(attributionSchema.safeParse({ source: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('checkoutRequestSchema attribution', () => {
  it('drops a malformed attribution instead of refusing the order', async () => {
    const { checkoutRequestSchema } = await import('./validation/checkout');
    const shape = checkoutRequestSchema.shape.attribution;
    expect(shape.parse({ source: 'x'.repeat(500) })).toBeUndefined();
    expect(shape.parse('garbage')).toBeUndefined();
    expect(shape.parse({ source: 'ig' })).toEqual({ source: 'ig' });
  });
});

describe('attributionDetails', () => {
  it('lists what was recorded', () => {
    expect(
      attributionDetails({ source: 'ig', medium: 'social', referrer: 'l.instagram.com', landing: '/products/shoper' }),
    ).toBe('utm: ig / social · з l.instagram.com · перша сторінка /products/shoper');
    expect(attributionDetails({})).toBe('');
  });
});

describe('attributionEventProps', () => {
  it('turns UTM tags into utm_* event props, named so they never clash with an event\'s own props', () => {
    expect(
      attributionEventProps({ source: 'google', medium: 'cpc', campaign: 'search-sumky-ua', landing: '/products' }),
    ).toEqual({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'search-sumky-ua' });
  });

  it('falls back to the referrer host as the source when there are no tags', () => {
    expect(attributionEventProps({ referrer: 'l.instagram.com', landing: '/' })).toEqual({ utm_source: 'l.instagram.com' });
  });

  it('sends nothing for a direct visit or no record', () => {
    expect(attributionEventProps(null)).toEqual({});
    expect(attributionEventProps({ landing: '/' })).toEqual({});
  });

  it('strips the two characters the stats script forbids in values', () => {
    expect(attributionEventProps({ source: 'a=b;c', campaign: 'x;y=z' })).toEqual({ utm_source: 'a-b-c', utm_campaign: 'x-y-z' });
  });
});
