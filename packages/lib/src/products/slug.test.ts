import { describe, expect, it } from 'vitest';
import { SKU_MAX_LENGTH, SLUG_MAX_LENGTH, slugify, suggestSku, transliterate } from './slug';

/**
 * These two functions decide what goes in a public URL and on a Nova Poshta
 * label, from Ukrainian text a manager typed. They are worth testing because
 * both outputs are hard to change later: a slug is in every link already shared
 * and in the Telegram deep link baked into `products/[slug].astro`, and a SKU is
 * printed on labels and read down the phone.
 *
 * The positional cases are the ones that actually break — `й`, `ю`, `я`, `є`
 * and `ї` transliterate differently at the start of a word than inside one, so
 * a naive single table produces «Kiyiv» where the country writes «Kyiv».
 */

describe('transliterate', () => {
  it('follows КМУ 55 on the positional letters', () => {
    // The standard's own examples.
    expect(transliterate('Київ')).toBe('kyiv');
    expect(transliterate('Єва')).toBe('yeva');
    expect(transliterate('Знам’янка')).toBe('znamianka');
    expect(transliterate('Юрій')).toBe('yurii');
    expect(transliterate('Яготин')).toBe('yahotyn');
    expect(transliterate('Її')).toBe('yii');
  });

  it('writes зг as zgh so it cannot collide with ж', () => {
    expect(transliterate('Згорани')).toBe('zghorany');
    expect(transliterate('Жорани')).toBe('zhorany');
  });

  it('separates г from ґ', () => {
    expect(transliterate('гуля')).toBe('hulia');
    expect(transliterate('ґуля')).toBe('gulia');
  });

  it('drops the soft sign and every shape of apostrophe', () => {
    for (const raw of ["п'ять", 'п’ять', 'пʼять']) {
      expect(transliterate(raw), raw).toBe('piat');
    }
    expect(transliterate('сіль')).toBe('sil');
  });

  it('leaves latin and digits alone', () => {
    expect(transliterate('Lunet 2')).toBe('Lunet 2');
  });

  it('maps the Russian letters a pasted title can carry', () => {
    // Not Ukrainian; mapped so an unexpected letter cannot silently vanish.
    expect(transliterate('ёлка')).toBe('elka');
    expect(transliterate('мыло')).toBe('mylo');
    expect(transliterate('подъезд')).toBe('podezd');
  });
});

describe('slugify', () => {
  it('turns a real product title into a URL segment', () => {
    expect(slugify('Сумка «Люнет»')).toBe('sumka-liunet');
    expect(slugify('Крос-боді міні')).toBe('kros-bodi-mini');
    expect(slugify('Гаманець')).toBe('hamanets');
  });

  it('collapses punctuation and whitespace into single hyphens', () => {
    expect(slugify('  Сумка   —   «Люнет» !!! ')).toBe('sumka-liunet');
    expect(slugify('30х17х10 см')).toBe('30kh17kh10-sm');
  });

  it('never starts or ends with a hyphen', () => {
    for (const raw of ['«Люнет»', '---Люнет---', '!Люнет!']) {
      const slug = slugify(raw);
      expect(slug.startsWith('-'), raw).toBe(false);
      expect(slug.endsWith('-'), raw).toBe(false);
    }
  });

  it('caps the length at a word boundary rather than mid-word', () => {
    const slug = slugify('Сумка шкіряна класична велика чорна на кожен день для міста');
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    // Cut at a hyphen, so the last segment is a whole word.
    expect(slug.split('-').at(-1)).not.toBe('');
  });

  it('caps a single unbroken word too', () => {
    const slug = slugify('а'.repeat(200));
    expect(slug.length).toBe(SLUG_MAX_LENGTH);
  });

  it('gives back an empty string when there is nothing to slug', () => {
    expect(slugify('')).toBe('');
    expect(slugify('«»  —  !')).toBe('');
  });
});

describe('suggestSku', () => {
  it('is the slug, uppercased, when the product has no colours', () => {
    expect(suggestSku('sumka-liunet')).toBe('SUMKA-LIUNET');
    expect(suggestSku('sumka-liunet', null)).toBe('SUMKA-LIUNET');
    expect(suggestSku('sumka-liunet', '  ')).toBe('SUMKA-LIUNET');
  });

  it('appends the transliterated colour', () => {
    expect(suggestSku('sumka-liunet', 'Чорний')).toBe('SUMKA-LIUNET-CHORNYI');
    expect(suggestSku('kros-bodi-mini', 'Молочний')).toBe('KROS-BODI-MINI-MOLOCHNYI');
  });

  it('caps the length', () => {
    const sku = suggestSku('sumka-shkiriana-klasychna-velyka', 'Темно-коричневий');
    expect(sku.length).toBeLessThanOrEqual(SKU_MAX_LENGTH);
    expect(sku.endsWith('-')).toBe(false);
  });
});
