import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { createDb } from '@balier/lib/db';
import { listActiveCategories } from '@balier/lib/db/queries/categories';
import { listActiveProducts } from '@balier/lib/db/queries/products';
import { formatPrice } from '@balier/lib/money';

export const prerender = false;

/**
 * `/llms.txt` (llmstxt.org): the site in one Markdown page for AI assistants
 * and their crawlers — what the brand is, how buying works, every product
 * with its price and URL, where the long-form pages are. Rendered from the
 * same queries as the catalog, so the list is never stale; cached for an hour
 * like the sitemap.
 *
 * Facts here mirror the pages (`/about`, `/delivery`, `/returns`, `/contacts`)
 * — when one of those changes, this must follow, or an assistant quotes the
 * old number.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const db = createDb(env.DATABASE_URL);
  const [categories, products] = await Promise.all([
    listActiveCategories(db),
    listActiveProducts(db),
  ]);

  const byCategory = categories.map((category) => ({
    ...category,
    products: products.filter((product) => product.categoryTitle === category.title),
  }));
  const uncategorised = products.filter((product) => product.categoryTitle === null);

  const line = (product: (typeof products)[number]) => {
    const colours =
      product.swatches.length > 0
        ? ` Кольори: ${product.swatches.map((swatch) => swatch.name).join(', ')}.`
        : '';
    const stock = product.inStock ? '' : ' Тимчасово немає в наявності.';
    return `- [${product.title}](${origin}/products/${product.slug}): ${formatPrice(product.price)}.${colours}${stock}`;
  };

  const sections = [
    ...byCategory.map(
      (category) =>
        `### ${category.title}\n\n${category.products.map(line).join('\n') || '- (поки порожньо)'}`,
    ),
    ...(uncategorised.length > 0 ? [`### Інше\n\n${uncategorised.map(line).join('\n')}`] : []),
  ];

  const body = `# BÁLIER

> Український бренд шкіряних виробів ручної роботи з Дніпра, з 2018 року: жіночі та чоловічі
> сумки, рюкзаки, дорожні сумки, гаманці й аксесуари. Обмежені партії, гарантія 3 роки,
> персоналізація тисненням або гравіруванням, палітра з понад 20 відтінків шкіри. Інтернет-магазин:
> ${origin}

## Як купити

- Оплата: карткою онлайн (Monobank) або накладеним платежем при отриманні.
- Доставка: Нова Пошта по всій Україні — відділення, поштомат або кур'єр, за тарифами
  перевізника; відправка протягом 1–2 робочих днів.
- Обмін і повернення: 14 днів для товару належної якості. Гарантія на вироби — 3 роки.
- Ціни на сайті в гривнях (UAH). Колір обирається на сторінці товару; інші кольори з палітри —
  під замовлення.
- Персоналізація (ініціали, дата, напис, зображення; тиснення або гравірування) — за
  домовленістю, вартість залежить від виробу.
- Для бізнесу: корпоративні подарунки та гуртові замовлення — блокноти в шкіряних обкладинках,
  брелоки, картхолдери, чохли для вина, костери, меню — з тисненням логотипу, подарунковим
  пакуванням і комплектацією наборів. Прорахунок за телефоном або поштою.

## Контакти

- Телефон: +38 (098) 602-66-26 (Viber, Telegram @balierua, будь-який месенджер)
- E-mail: baliershopua@gmail.com
- Instagram: https://www.instagram.com/balier.ua/
- Facebook: https://www.facebook.com/balier.ua/
- Адреса: Майдан Озерний, 19, Дніпро, 49245 — https://maps.app.goo.gl/yqgARu2AWK3mDR7z5
- Продавець: ФОП Баланюк Владислав Вікторович

## Каталог

${sections.join('\n\n')}

## Сторінки

- [Усі товари](${origin}/products)
- [Про нас](${origin}/about): історія бренду, майстерня, цифри
- [Палітра шкіри](${origin}/palette): гладка, фактурна, рептилія, замша, вінтажна — усі кольори
- [Персоналізація](${origin}/personalization): тиснення та гравірування
- [Для бізнесу](${origin}/corporate): корпоративні подарунки, гуртові замовлення, брендування тисненням логотипу
- [Догляд за шкірою](${origin}/care)
- [Доставка](${origin}/delivery)
- [Повернення та обмін](${origin}/returns)
- [Контакти](${origin}/contacts)
- [Публічна оферта](${origin}/offer)
- [Політика конфіденційності](${origin}/privacy)
- [Sitemap](${origin}/sitemap.xml)
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
