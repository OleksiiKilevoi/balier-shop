/**
 * Turning what a manager types into what a URL and a warehouse label can hold.
 *
 * Product titles are Ukrainian («Сумка "Люнет"»), while `products.slug` ends up
 * in a public URL and `product_variants.sku` gets read down a phone and typed
 * into Nova Poshta's system. Both therefore have to be latin, and nothing in
 * this repo generated either before now — every slug and SKU in the catalog is a
 * hand-written literal in `scripts/test-catalog.ts`.
 *
 * What these two functions produce is a *suggestion*. The admin form prefills
 * the field and leaves it editable, because transliteration has no single right
 * answer and the manager is the one who knows whether this bag is `lunet` or
 * `sumka-lunet`.
 */

/** Long enough for «сумка-крос-боді-міні-чорна», short enough to read in a URL. */
export const SLUG_MAX_LENGTH = 60;

/** Nova Poshta prints this on the label; past ~40 characters it stops being useful. */
export const SKU_MAX_LENGTH = 40;

/**
 * КМУ 55 (2010) — the table Ukrainian passports and road signs use, so a slug
 * built from it matches how the name is already spelled everywhere else in the
 * country. Five letters are positional: `є ї й ю я` take a `y…` form when they
 * open a word and an `i…` form inside one (Єва → Yeva, Київ → Kyiv).
 */
const WORD_START: Record<string, string> = {
  є: 'ye',
  ї: 'yi',
  й: 'y',
  ю: 'yu',
  я: 'ya',
};

const WORD_INNER: Record<string, string> = {
  є: 'ie',
  ї: 'i',
  й: 'i',
  ю: 'iu',
  я: 'ia',
};

const LETTERS: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  // The soft sign and the apostrophe are dropped, as the standard requires.
  ь: '',
  "'": '',
  '’': '',
  'ʼ': '',
  /*
   * Not Ukrainian, and deliberately here anyway: a title pasted out of a
   * supplier's spreadsheet can carry these, and silently dropping an unmapped
   * letter would turn «Ёлка» into «lka» rather than failing visibly.
   */
  ё: 'e',
  ы: 'y',
  э: 'e',
  ъ: '',
};

/** `зг` is `zgh`, not `zh` — otherwise Згорани and Жорани collide. */
const ZGH = 'zgh';

function isWordCharacter(char: string | undefined): boolean {
  if (char === undefined) return false;
  const lower = char.toLowerCase();
  return /[a-z0-9]/.test(lower) || lower in LETTERS || lower in WORD_START;
}

/**
 * Ukrainian (and, where it costs nothing, Russian) Cyrillic to latin.
 * Anything already latin passes through untouched; anything unmapped is left
 * alone for `slugify` to deal with as punctuation.
 */
export function transliterate(input: string): string {
  const chars = [...input];
  const out: string[] = [];

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]!;
    const lower = char.toLowerCase();

    if (lower === 'з' && chars[i + 1]?.toLowerCase() === 'г') {
      out.push(ZGH);
      i += 1;
      continue;
    }

    if (lower in WORD_START) {
      const atWordStart = !isWordCharacter(chars[i - 1]);
      out.push((atWordStart ? WORD_START : WORD_INNER)[lower]!);
      continue;
    }

    out.push(lower in LETTERS ? LETTERS[lower]! : char);
  }

  return out.join('');
}

function collapse(value: string, separator: string): string {
  const pattern = new RegExp(`${separator}{2,}`, 'g');
  const edges = new RegExp(`^${separator}+|${separator}+$`, 'g');
  return value.replace(pattern, separator).replace(edges, '');
}

/**
 * Cuts to `max` without leaving a half-word: if a separator is close enough to
 * the end, the cut happens there instead.
 */
function truncate(value: string, max: number, separator: string): string {
  if (value.length <= max) return value;

  const cut = value.slice(0, max);
  const lastBreak = cut.lastIndexOf(separator);
  const trimmed = lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut;
  return collapse(trimmed, separator);
}

/** «Сумка «Люнет»» → `sumka-liunet`. Empty in, empty out — the caller decides. */
export function slugify(title: string): string {
  const latin = transliterate(title).toLowerCase();
  const hyphenated = latin.replace(/[^a-z0-9]+/g, '-');
  return truncate(collapse(hyphenated, '-'), SLUG_MAX_LENGTH, '-');
}

/**
 * `sumka-liunet` + «Чорний» → `SUMKA-LIUNET-CHORNYI`.
 *
 * The colour goes in transliterated in full rather than abbreviated to `BLK`:
 * an abbreviation table would need an entry per colour the shop ever sells and
 * would guess wrong on «Пудровий», and the field is editable anyway — a manager
 * who wants `-BLK` types four characters.
 */
export function suggestSku(slug: string, colorName?: string | null): string {
  const parts = [slug, colorName ?? ''].filter((part) => part.trim() !== '');
  const latin = transliterate(parts.join('-')).toUpperCase();
  const hyphenated = latin.replace(/[^A-Z0-9]+/g, '-');
  return truncate(collapse(hyphenated, '-'), SKU_MAX_LENGTH, '-');
}
