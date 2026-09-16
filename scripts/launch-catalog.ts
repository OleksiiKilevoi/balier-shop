/**
 * The launch catalog — `docs/plans/catalog.md` as data, loaded once into the
 * production database by `load-catalog.ts`. Copy is the draft's, with every
 * `[уточнити]` claim removed rather than guessed; the owner corrects the rest
 * (dimensions, weight, leather) in the panel.
 *
 * Photo names are the stems from the owner's folder (`IMG_0457`,
 * `PXL_20251124_083141241`); the loader resolves each to the one file whose
 * name starts with it. The first photo of a product is its hero.
 */

export interface LaunchCategory {
  slug: string;
  title: string;
  position: number;
}

export interface LaunchVariant {
  sku: string;
  colorName: string;
  colorHex: string;
  /** Photo stems that show this colour; the rest are product-level. */
  photos?: string[];
}

export interface LaunchProduct {
  slug: string;
  title: string;
  description: string;
  /** One line per bullet. */
  details: string;
  priceUah: number;
  categorySlug: string;
  isFeatured?: boolean;
  variants: LaunchVariant[];
  /** Product-level photos, hero first. */
  photos: string[];
}

export const LAUNCH_CATEGORIES: LaunchCategory[] = [
  { slug: 'womens-bags', title: 'Жіночі сумки', position: 1 },
  { slug: 'mens-bags', title: 'Чоловічі сумки', position: 2 },
  { slug: 'backpacks-travel', title: 'Рюкзаки та дорожні сумки', position: 3 },
  { slug: 'wallets', title: 'Гаманці та аксесуари', position: 4 },
];

const BLACK = '#1a1a1c';
const BROWN = '#6b4a32';
const DARK_BROWN = '#3f2a1d';

export const LAUNCH_PRODUCTS: LaunchProduct[] = [
  {
    slug: 'dorozhnia-sumka-z-remintsiamy',
    title: 'Дорожня сумка з ремінцями',
    description:
      'Дорожня сумка, з якою вихідні починаються ще на вокзалі. Щільна фактурна шкіра тримає форму навіть порожньою, руді ремені з пряжками на боках і контрастна підкладка всередині роблять її впізнаваною з першого погляду. Дві ручки, знімний плечовий ремінь, одне велике відділення на блискавці.',
    details: 'Тримає форму\nЗнімний плечовий ремінь\nРемені з пряжками по боках',
    priceUah: 9900,
    categorySlug: 'backpacks-travel',
    isFeatured: true,
    variants: [{ sku: 'TRAVEL-STRAPS-BRN', colorName: 'Коричневий', colorHex: BROWN }],
    photos: [
      'IMG_0457',
      'IMG_0449',
      'IMG_0450',
      'IMG_0458',
      'IMG_0460',
      'IMG_0466',
      'IMG_0470',
      'IMG_0472',
      'IMG_0480',
      'IMG_0482',
    ],
  },
  {
    slug: 'dorozhnia-sumka-boston',
    title: 'Дорожня сумка «Бостон»',
    description:
      'Компактніша дорожня сумка в гладкій чорній шкірі — на одну ніч або в спортзал, куди не хочеться йти з рюкзаком. Дві шкіряні ручки, зовнішня кишеня на блискавці, лаконічна форма без зайвого.',
    details: 'Гладка шкіра\nЗовнішня кишеня на блискавці\nДві ручки',
    priceUah: 8400,
    categorySlug: 'backpacks-travel',
    variants: [{ sku: 'BOSTON-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_1381', 'IMG_1425'],
  },
  {
    slug: 'portfel-dlia-noutbuka',
    title: 'Портфель для ноутбука',
    description:
      'Портфель, який виглядає доречно і на зустрічі, і в літаку. Гладка шкіра, два відділення на блискавках, зовнішня кишеня під телефон і документи, знімний ремінь для плеча.',
    details: 'Відділ для ноутбука\nДва відділення на блискавці\nЗнімний плечовий ремінь\nДва кольори',
    priceUah: 7900,
    categorySlug: 'mens-bags',
    isFeatured: true,
    variants: [
      {
        sku: 'BRIEF-DBR',
        colorName: 'Темно-коричневий',
        colorHex: DARK_BROWN,
        photos: [
          'PXL_20251124_083141241',
          'PXL_20251124_083226146',
          'PXL_20251124_083250066',
          'PXL_20251124_083406337',
          'PXL_20251124_083513635',
          'PXL_20251124_083545202',
          'PXL_20251124_083609750',
          'PXL_20251124_083637629',
        ],
      },
      { sku: 'BRIEF-BLK', colorName: 'Чорний', colorHex: BLACK, photos: ['IMG_1463'] },
    ],
    photos: ['IMG_0745', 'IMG_0945', 'IMG_0960'],
  },
  {
    slug: 'sumka-cherez-pleche-z-klapanom',
    title: 'Сумка через плече з клапаном',
    description:
      'Невелика горизонтальна сумка з клапаном і тисненням BÁLIER — для телефону, гаманця і ключів, коли кишень не вистачає, а рюкзак завеликий. Носиться через плече на регульованому ремені або в руці за коротку ручку.',
    details: 'Регульований ремінь\nКоротка ручка\nТиснення логотипа',
    priceUah: 4900,
    categorySlug: 'mens-bags',
    variants: [{ sku: 'FLAP-CROSS-DBR', colorName: 'Темно-коричневий', colorHex: DARK_BROWN }],
    photos: ['IMG_0839', 'IMG_0833', 'IMG_0859', 'IMG_0866', 'IMG_0868', 'IMG_0884', 'IMG_0904'],
  },
  {
    slug: 'mesendzher-z-klapanom',
    title: 'Сумка-месенджер з клапаном',
    description:
      'Вертикальний месенджер у гладкій чорній шкірі. Під клапаном — кишеня на блискавці, всередині — основне відділення; клапан тримається на двох магнітах. Широкий ремінь з регулюванням — на плече або через груди.',
    details: 'Клапан на двох магнітах\nКишеня на блискавці під клапаном\nРегульований ремінь',
    priceUah: 5400,
    categorySlug: 'mens-bags',
    variants: [{ sku: 'MESSENGER-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: [
      'IMG_6693',
      'IMG_6694',
      'IMG_6695',
      'IMG_6696',
      'IMG_6697',
      'PXL_20251111_111511706',
      'PXL_20251111_111544438',
      'PXL_20251111_111649995',
      'PXL_20251111_111732750',
      'PXL_20251111_111748815',
      'PXL_20251111_112123732',
      'PXL_20251111_112144147',
      'PXL_20251111_112207100',
      'PXL_20251111_112216909',
    ],
  },
  {
    slug: 'sumka-cherez-pleche-na-blyskavtsi',
    title: 'Сумка через плече на блискавці',
    description:
      'Вертикальна сумка через плече з фактурної шкіри: зовнішня кишеня на блискавці спереду, основне відділення на блискавці зверху, шкіряний ремінь з карабінами. Достатньо для всього щоденного.',
    details: 'Фактурна шкіра\nДві блискавки\nЗнімний ремінь на карабінах',
    priceUah: 5200,
    categorySlug: 'mens-bags',
    isFeatured: true,
    variants: [{ sku: 'ZIP-CROSS-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: [
      'IMG_6296',
      'IMG_6285',
      'IMG_6287',
      'IMG_6288',
      'IMG_6290',
      'IMG_6293',
      'IMG_6297',
      'IMG_6298',
      'IMG_6299',
    ],
  },
  {
    slug: 'klatch-barsetka',
    title: 'Клатч-барсетка з ремінцем',
    description:
      "Барсетка на дві блискавки в гладкій чорній шкірі: одне відділення під телефон і гаманець, друге — під дрібниці. Ремінець на зап'ястя, який знімається, якщо сумку кладуть у портфель.",
    details: "Дві блискавки\nЗнімний ремінець на зап'ястя\nГладка шкіра",
    priceUah: 3600,
    categorySlug: 'mens-bags',
    variants: [{ sku: 'CLUTCH-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_0969', 'IMG_0940', 'IMG_0984', 'IMG_0993', 'IMG_1001', 'IMG_1155'],
  },
  {
    slug: 'riukzak',
    title: 'Рюкзак',
    description:
      "Міський рюкзак з фактурної шкіри, який не боїться дощу і щоденного метро. Основне відділення на блискавці, зовнішня кишеня спереду, м'яка спинка і широкі шкіряні лямки з регулюванням.",
    details: 'Фактурна шкіра\nРегульовані шкіряні лямки\nЗовнішня кишеня\nТри кольори',
    priceUah: 8900,
    categorySlug: 'backpacks-travel',
    isFeatured: true,
    variants: [
      {
        sku: 'BACKPACK-BLK',
        colorName: 'Чорний',
        colorHex: BLACK,
        photos: [
          'PXL_20260110_175423738',
          'PXL_20260110_175434314',
          'PXL_20260110_175524873',
          'PXL_20260110_175551475',
          'PXL_20260110_175601714',
          'PXL_20260110_175614466',
          'PXL_20260110_175755320',
          'PXL_20260110_175831333',
        ],
      },
      { sku: 'BACKPACK-DBR', colorName: 'Темно-коричневий', colorHex: DARK_BROWN },
      { sku: 'BACKPACK-BRN', colorName: 'Коричневий', colorHex: BROWN },
    ],
    photos: ['PXL_20260110_184439872', 'PXL_20260110_185617641', 'PXL_20260110_185648370'],
  },
  {
    slug: 'sumka-na-pleche',
    title: 'Сумка на плече',
    description:
      'Сумка на плече з гладкої шкіри у формі, яка не виходить з моди: чиста лінія, блискавка зверху, регульований ремінь — коротко на плече або довше через тіло.',
    details: 'Гладка шкіра\nРегульований ремінь\nБлискавка зверху\nДва кольори',
    priceUah: 5500,
    categorySlug: 'womens-bags',
    isFeatured: true,
    variants: [
      {
        sku: 'SHOULDER-BLK',
        colorName: 'Чорний',
        colorHex: BLACK,
        photos: [
          'PXL_20251219_090521898',
          'PXL_20251219_083512555',
          'PXL_20251219_083540600',
          'PXL_20251219_083545985',
          'PXL_20251219_083607079',
          'PXL_20251219_090548089',
        ],
      },
      {
        sku: 'SHOULDER-MLK',
        colorName: 'Молочний',
        colorHex: '#efe8dc',
        photos: [
          'PXL_20251219_084231060',
          'PXL_20251219_084320183',
          'PXL_20251219_084610573',
          'PXL_20251219_084653641',
          'PXL_20251219_084708195',
          'PXL_20251219_084732299',
          'PXL_20251219_084740691',
          'PXL_20251219_084747587',
        ],
      },
    ],
    photos: [],
  },
  {
    slug: 'sumka-bahet-zamsha',
    title: 'Сумка-багет із замші',
    description:
      "Багет із м'якої замші кольору какао. Коротка ручка для руки і довгий ремінь через плече, одне відділення на блискавці. Замша — про дотик, тож ця сумка для сухих днів і вечорів.",
    details: 'Замша\nДві ручки: коротка і довга\nБлискавка зверху',
    priceUah: 4900,
    categorySlug: 'womens-bags',
    variants: [{ sku: 'BAGUETTE-SUEDE-BRN', colorName: 'Коричневий', colorHex: BROWN }],
    photos: [
      'PXL_20251227_113823270',
      'PXL_20251227_112827031',
      'PXL_20251227_112902760',
      'PXL_20251227_112941165',
      'PXL_20251227_113907362',
    ],
  },
  {
    slug: 'sumka-bouling',
    title: 'Сумка «Боулінг» з двома ручками',
    description:
      'Витягнута сумка з двома короткими ручками — на плече або в руку. Блискавка на всю довжину; довгий ремінь у комплекті, щоб носити через тіло.',
    details: 'Дві ручки + довгий ремінь\nБлискавка на всю довжину\nГладка шкіра або нубук',
    priceUah: 5900,
    categorySlug: 'womens-bags',
    variants: [
      {
        sku: 'BOWLING-CHOC',
        colorName: 'Шоколад, гладка шкіра',
        colorHex: '#4a2c1a',
        photos: [
          'IMG_4300',
          'IMG_4298',
          'IMG_4299',
          'IMG_4301',
          'IMG_4302',
          'IMG_4305',
          'IMG_4307',
          'IMG_4309',
        ],
      },
      {
        sku: 'BOWLING-NUBUCK',
        colorName: 'Коричневий, нубук',
        colorHex: '#7a5236',
        photos: [
          'PXL_20260310_144424594',
          'PXL_20260310_144438393',
          'PXL_20260310_144447042',
          'PXL_20260310_144552140',
          'PXL_20260310_144557031',
        ],
      },
    ],
    photos: [],
  },
  {
    slug: 'shoper',
    title: 'Шопер',
    description:
      'Шопер з гладкої шкіри, в який входить ноутбук, планер і все, що зазвичай «не влазить». Довгі ручки на плече, тиснення BÁLIER.',
    details: 'Довгі ручки\nТиснення логотипа\nГладка шкіра',
    priceUah: 6900,
    categorySlug: 'womens-bags',
    variants: [{ sku: 'TOTE-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_4247', 'IMG_4115', 'IMG_4242', 'IMG_4245', 'IMG_4250'],
  },
  {
    slug: 'shoper-pid-pitona',
    title: 'Шопер із тисненням під пітона',
    description:
      'Той самий шопер у шкірі з тисненням під пітона кольору графіт — фактура, яку помічають. Ланцюжок на ручках.',
    details: 'Тиснення під пітона\nЛанцюжок на ручках',
    priceUah: 7400,
    categorySlug: 'womens-bags',
    isFeatured: true,
    variants: [{ sku: 'TOTE-PYTHON-GRA', colorName: 'Графіт', colorHex: '#3b3b3f' }],
    photos: [
      'PXL_20260305_141945496',
      'PXL_20260305_140406412',
      'PXL_20260305_140429936',
      'PXL_20260305_140527320',
      'PXL_20260305_140531002',
      'PXL_20260305_140722893',
      'PXL_20260305_140735307',
      'PXL_20260305_141920199',
    ],
  },
  {
    slug: 'sumka-dlia-telefonu',
    title: 'Сумка для телефону',
    description:
      'Замшева сумочка на телефон з плетеним шнуром замість ременя. Кишеня спереду для картки й ключа. Для прогулянки, коли з собою має бути тільки телефон.',
    details: 'Замша\nПлетений шнур\nПередня кишеня',
    priceUah: 2400,
    categorySlug: 'wallets',
    variants: [{ sku: 'PHONE-SUEDE-DBR', colorName: 'Темно-коричневий', colorHex: DARK_BROWN }],
    photos: ['PXL_20260110_181551634', 'PXL_20260110_181613648', 'PXL_20260110_181742426'],
  },
  {
    slug: 'hamanets-konvert',
    title: 'Гаманець-конверт',
    description:
      'Довгий гаманець, складений як конверт — без жодної зайвої деталі зовні. Всередині — відділ на блискавці.',
    details: 'Формат конверта\nВідділ на блискавці\nГладка шкіра',
    priceUah: 1950,
    categorySlug: 'wallets',
    isFeatured: true,
    variants: [{ sku: 'WALLET-ENVELOPE-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_6309', 'IMG_6310', 'IMG_6311', 'IMG_6312'],
  },
  {
    slug: 'portmone-z-khliastykom',
    title: 'Портмоне з хлястиком на кнопці',
    description:
      'Портмоне на хлястику з кнопкою: розгортається в довгий органайзер — відділи для карток, купюр, документів і монетниця на блискавці.',
    details: 'Хлястик на кнопці\nМонетниця на блискавці\nВідділи для карток і документів',
    priceUah: 2200,
    categorySlug: 'wallets',
    variants: [{ sku: 'WALLET-STRAP-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_6301', 'IMG_6302', 'IMG_6303', 'IMG_6304', 'IMG_6305', 'IMG_6698', 'IMG_6312'],
  },
  {
    slug: 'portmone-travel',
    title: 'Портмоне тревел на двох кнопках',
    description:
      'Портмоне на дві кнопки з відділом на блискавці посередині — для тих, хто носить дві валюти або багато карток. Розкривається плоско, лежить у внутрішній кишені пальта.',
    details: 'Дві кнопки\nВідділ на блискавці\nГладка шкіра',
    priceUah: 2400,
    categorySlug: 'wallets',
    variants: [{ sku: 'WALLET-TRAVEL-BLK', colorName: 'Чорний', colorHex: BLACK }],
    photos: ['IMG_6308', 'IMG_6312'],
  },
];
