import { describe, expect, it } from 'vitest';
import { addressSearchText, fold, searchText } from './normalize';

/**
 * The cases below are the ones that actually cost us orders, not synthetic
 * ones: a customer on a Russian keyboard cannot type `і`, so every Ukrainian
 * name containing it arrives misspelled and matched nothing before this.
 */

describe('fold', () => {
  it('collapses the і/ї/ы/й family so a Russian keyboard finds a Ukrainian name', () => {
    // No `і` on a Russian layout — this is the single most common miss.
    expect(fold('Дніпро')).toBe(fold('Днипро'));
    expect(fold('Харків')).toBe(fold('Харкив'));
    expect(fold('Київ')).toBe(fold('Кыив'));
    expect(fold('Мар’їнка')).toBe(fold('Марьинка'));
  });

  it('collapses є/э/ё and ґ/г', () => {
    expect(fold('Комсомольське')).toBe(fold('Комсомольскэ'));
    expect(fold('Ґрунь')).toBe(fold('Грунь'));
  });

  it('drops apostrophes and soft signs, which never distinguish two settlements', () => {
    expect(fold("Кам'янське")).toBe(fold('Камянське'));
    expect(fold('Кам’янське')).toBe(fold("Кам'янське"));
    expect(fold('Донецьк')).toBe('донецк');
  });

  it('turns punctuation into single spaces and trims', () => {
    expect(fold('  Івано-Франківськ  ')).toBe('ивано франкивск');
    expect(fold('Київ (Київська обл.)')).toBe('киив киивска обл');
  });

  it('leaves Latin translit alone beyond lowercasing', () => {
    expect(fold('Abazivka')).toBe('abazivka');
    expect(fold('Ivano-Frankivsk')).toBe('ivano frankivsk');
  });

  it('returns an empty string for input with nothing matchable in it', () => {
    expect(fold('')).toBe('');
    expect(fold('—  ,. ')).toBe('');
  });
});

describe('searchText', () => {
  it('indexes the Ukrainian, Russian and translit spellings together', () => {
    // The soft sign is dropped by the fold, so «Львів» is stored as «лвив».
    const text = searchText('Львів', 'Львов', 'Lviv');
    expect(text).toContain('лвив');
    expect(text).toContain('лвов');
    expect(text).toContain('lviv');
  });

  it('stores a separator-free variant so a name typed without its hyphen matches', () => {
    const text = searchText('Івано-Франківськ');
    expect(text).toContain('ивано франкивск');
    expect(text).toContain('иванофранкивск');
  });

  it('does not store the same spelling twice', () => {
    // Most villages have Description === DescriptionRu; 26 791 rows of that
    // duplication is pure trigram-index weight.
    expect(searchText('Грунь', 'Грунь')).toBe('грунь'.replace('ь', ''));
    expect(searchText('Абазівка', 'Абазовка', 'Abazivka').split(' ')).toHaveLength(3);
  });

  it('skips missing spellings rather than leaving holes', () => {
    expect(searchText('Львів', null, undefined, '')).toBe('лвив');
  });

  it('is stable under the query fold, which is the whole point', () => {
    // What the sync writes and what the customer's typing is reduced to have
    // to agree, or the index matches nothing.
    const stored = searchText('Дніпро', 'Днепр', 'Dnipro');
    expect(stored.includes(fold('Днипро'))).toBe(true);
    expect(stored.includes(fold('ДНЕПР'))).toBe(true);
  });
});

describe('addressSearchText', () => {
  const branch = 'Відділення №12: вул. Івана Мазепи, 4';

  it('still matches what the customer types, folded the same way', () => {
    const stored = addressSearchText(branch, 'Отделение №12: ул. Ивана Мазепы, 4');

    expect(stored).toContain(fold('відділення 12'));
    expect(stored).toContain(fold('мазепи'));
    // The Russian description is the reason both spellings are indexed at all.
    expect(stored).toContain(fold('Мазепы'));
  });

  it('does not store the separator-free copy of an address', () => {
    // ~200 bytes per row across 53 556 warehouses, matching a query nobody
    // types: this is the storage half of the change, so it is asserted.
    const stored = addressSearchText(branch);

    expect(stored).not.toContain('виддилення12вул');
    expect(stored.length).toBeLessThan(searchText(branch).length);
  });

  it('is otherwise identical to searchText — same fold, same de-duplication', () => {
    // A name with no separators has no collapsed variant to drop, so the two
    // agree exactly; that is what keeps one fold valid for both columns.
    expect(addressSearchText('Грунь', 'Грунь')).toBe(searchText('Грунь', 'Грунь'));
    expect(addressSearchText('Львів', null, undefined, '')).toBe('лвив');
  });
});
