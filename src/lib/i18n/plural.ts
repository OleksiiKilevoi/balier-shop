/**
 * Ukrainian has three plural forms, and picking between them by hand
 * (`n === 1 ? … : n < 5 ? … : …`) is wrong for 11–14 and for 21, 101, 1001.
 * `Intl.PluralRules` knows the CLDR rules and ships with the runtime.
 *
 * Module-scope, but immutable and stateless — safe across isolates.
 */
const rules = new Intl.PluralRules('uk-UA');

export interface UkPluralForms {
  /** 1, 21, 31 — «1 товар» */
  one: string;
  /** 2–4, 22–24 — «3 товари» */
  few: string;
  /** 0, 5–20, 25–30 — «7 товарів» */
  many: string;
}

/** Returns the noun form only. The caller decides how to join it to the number. */
export function pluralUk(count: number, forms: UkPluralForms): string {
  const category = rules.select(count);
  if (category === 'one') return forms.one;
  if (category === 'few') return forms.few;
  return forms.many;
}
