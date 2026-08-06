/**
 * Search-text normalisation for the `/checkout` delivery pickers.
 *
 * The problem this solves is not typos — it's that a Ukrainian customer types
 * a Ukrainian place name on whatever keyboard they happen to have. Three
 * separate mismatches show up in real orders:
 *
 *  1. **Russian keyboard, Ukrainian name.** There is no `і` on a Russian
 *     layout, so «Дніпро» gets typed «Днипро» and «Харків» «Харкив». Folding
 *     `і ї ы й → и` makes both sides collapse to the same string.
 *  2. **A genuinely different Russian name.** «Львів»/«Львов»,
 *     «Миколаїв»/«Николаев» — no character fold can bridge those, because they
 *     are different words. That's what `name_ru` is for: Nova Poshta hands us
 *     `DescriptionRu` on every settlement and we simply index it too.
 *  3. **Latin keyboard.** `DescriptionTranslit` («Abazivka») covers it.
 *
 * All three end up concatenated into one `search_text` column so a single
 * `ilike '%q%'` (or trigram match) hits whichever spelling the customer used.
 *
 * Area and region names are deliberately NOT folded in: they would make «київ»
 * match all ~1 000 settlements of Київська область and push the actual city
 * out of a 10-row dropdown.
 */

/**
 * Cyrillic characters that must collapse onto one representative before
 * matching. The `и` group is the important one (see (1) above); the rest are
 * cheap insurance against layout and orthography drift. Anything mapped to `''`
 * is deleted outright — a soft sign or apostrophe never distinguishes two real
 * settlements, but it does distinguish two spellings of the same one
 * («Кам'янець» vs «Камянець»).
 */
const CHARACTER_FOLD: Record<string, string> = {
  і: 'и',
  ї: 'и',
  ы: 'и',
  й: 'и',
  є: 'е',
  э: 'е',
  ё: 'е',
  ґ: 'г',
  ь: '',
  ъ: '',
  "'": '',
  '’': '',
  ʼ: '',
  '`': '',
  '´': '',
};

/**
 * Lowercase, fold the character classes above, and reduce every run of
 * punctuation or whitespace to a single space. Hyphens becoming spaces is the
 * point for «Івано-Франківськ» — see `searchText`, which also stores the
 * separator-free variant so both «івано франківськ» and «іванофранківськ»
 * match.
 */
export function fold(value: string): string {
  let out = '';

  for (const character of value.toLowerCase()) {
    const folded = CHARACTER_FOLD[character];
    if (folded !== undefined) {
      out += folded;
      continue;
    }
    out += /[\p{L}\p{N}]/u.test(character) ? character : ' ';
  }

  return out.replace(/\s+/g, ' ').trim();
}

function foldAll(
  values: (string | null | undefined)[],
  { separatorFreeVariant }: { separatorFreeVariant: boolean },
): string {
  const parts = new Set<string>();

  for (const value of values) {
    if (!value) continue;

    const folded = fold(value);
    if (!folded) continue;
    parts.add(folded);

    if (separatorFreeVariant) {
      // «івано франківськ» typed without the hyphen is still «Івано-Франківськ».
      const collapsed = folded.replaceAll(' ', '');
      if (collapsed !== folded) parts.add(collapsed);
    }
  }

  return [...parts].join(' ');
}

/**
 * Builds the indexed blob from every spelling Nova Poshta gives us for one
 * settlement. Duplicates are dropped because most villages have `Description ===
 * DescriptionRu`, and storing that twice across 26 791 rows only inflates the
 * trigram index.
 */
export function searchText(...values: (string | null | undefined)[]): string {
  return foldAll(values, { separatorFreeVariant: true });
}

/**
 * The same, for a branch's *address* — which is what a warehouse description
 * is: «Відділення №12: вул. Соборна, 4».
 *
 * The difference is the separator-free variant above, which is dropped here.
 * It exists so «іванофранківськ» finds a hyphenated city name; nobody types a
 * street address run together, so on 53 556 warehouse rows it was ~200 bytes
 * each of stored text that no query could ever match — the widest column in the
 * database, rewritten nightly.
 */
export function addressSearchText(...values: (string | null | undefined)[]): string {
  return foldAll(values, { separatorFreeVariant: false });
}

/**
 * The same fold applied to what the customer typed. Kept as its own name so
 * the call sites read as the pair they are — an index is only ever as good as
 * the query being normalised identically.
 */
export function foldQuery(query: string): string {
  return fold(query);
}
