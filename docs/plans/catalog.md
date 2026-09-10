# PLAN — The launch catalog (from `~/Downloads/balier`)

## Goal

Every product in the client's photo folder exists in the production database with a Ukrainian
title, description, details, a price, its colour variants and its photos, ready for the panel to
correct and publish. This file is the **draft for review** — nothing here is loaded until the
prices and the grouping are confirmed. Written 2026-09-07 from the 130 photos in the folder (no
names, no captions, no prices came with them), the three products the repo already knew
(`scripts/test-catalog.ts`: Lunet 5 500 ₴, Space 4 800 ₴, the wallet 1 950 ₴) and the brand's
Instagram bio («Твій щоденний акцент · Преміум якість · Створюємо з 2018 р. ·
Тиснення/Гравіювання»; highlights: чоловічі сумки, жіночі сумки, шопер, гаманці, капці,
гравіювання).

## How the prices were set

Anchor: **BlankNote** (`blanknote.ua`), the closest Ukrainian handmade brand by material and
positioning, read on 2026-09-07: backpacks 6 300–8 250 ₴ (Foster 8 250), travel bags
7 260–14 940 ₴ (Harper MAXI 9 210, Люкс 14 940), laptop bags 6 510–8 580 ₴ (Porte 7 080),
women's shoulder bags 4 800–5 220 ₴ (Tessa 5 220, Midi 4 830), phone pouch Tina 2 370 ₴,
wallets 930–1 500 ₴ (zip wallet 2 910). Mass-market crossbodies sit at 1 850–3 500 ₴
(Gravyar, 7Bags), imports at 9 900 ₴+ (EmpireBags). BÁLIER's own wallet at 1 950 ₴ is *above*
BlankNote's wallets and its bags sat at BlankNote's mid-range, so every price below is placed
**at BlankNote's upper-middle, never at its ceiling** — premium by finish, not by name. Whole
hundreds, the way the brand already writes them. Every price is a proposal.

## Categories

Four, extending the three the repo had (`womens-bags`, `mens-bags`, `wallets`):

| slug | title | position |
|---|---|---|
| `womens-bags` | Жіночі сумки | 1 |
| `mens-bags` | Чоловічі сумки | 2 |
| `backpacks-travel` | Рюкзаки та дорожні сумки | 3 |
| `wallets` | Гаманці та аксесуари | 4 |

## The products

Photo numbers are the contact-sheet index (1–130, sorted by file name); the file names are the
ones in the folder. **Hero** is the proposed first image. Copy is written only from what the
photos show — every unseen fact is `[уточнити]` and stays out of the site until the client fills
the table at the end.

### 1. Дорожня сумка з ремінцями — коричнева · 9 900 ₴ · `backpacks-travel` · featured

Photos (10): IMG_0449, 0450, 0457 (**hero**), 0458, 0460, 0466, 0470, 0472, 0480, 0482.
Variants: коричневий з рудими ремінцями.

> Дорожня сумка, з якою вихідні починаються ще на вокзалі. Щільна фактурна шкіра тримає форму
> навіть порожньою, руді ремені з пряжками на боках і контрастна підкладка всередині роблять її
> впізнаваною з першого погляду. Дві ручки, знімний плечовий ремінь, одне велике відділення на
> блискавці.

Details: Тримає форму · Знімний плечовий ремінь · Ремені з пряжками по боках · Вміщує речі на
2–3 дні [уточнити]

Price: BlankNote's leather travel bags run 7 260–14 940; this is their Harper MAXI class
(9 210) with more hardware. 9 900.

### 2. Дорожня сумка «Бостон» — чорна · 8 400 ₴ · `backpacks-travel`

Photos (2): IMG_1381 (**hero**), IMG_1425.
Variants: чорний.

> Компактніша дорожня сумка в гладкій чорній шкірі — на одну ніч або в спортзал, куди не хочеться
> йти з рюкзаком. Дві шкіряні ручки, зовнішня кишеня на блискавці, лаконічна форма без зайвого.

Details: Гладка шкіра · Зовнішня кишеня на блискавці · Дві ручки

Price: smaller and plainer than №1 → one step down. 8 400. Only two photos — worth a studio
shot before launch.

### 3. Портфель для ноутбука — 7 900 ₴ · `mens-bags` · featured

Photos (12): IMG_0745 (**hero**, темно-коричневий), IMG_0945, IMG_0960, IMG_1463 (чорний),
PXL_20251124_083141241, 083226146, 083250066, 083406337, 083513635, 083545202, 083609750,
083637629 (studio, темно-коричневий).
Variants: темно-коричневий, чорний.

> Портфель, який виглядає доречно і на зустрічі, і в літаку. Гладка шкіра, два відділення на
> блискавках, зовнішня кишеня з магнітом [уточнити] під телефон і документи, знімний ремінь для
> плеча. Всередині — шкіряна підкладка [уточнити] і відділ для ноутбука до 15" [уточнити].

Details: Відділ для ноутбука · Два відділення на блискавці · Знімний плечовий ремінь ·
Два кольори

Price: BlankNote laptop bags 6 510–8 580, Porte 7 080. 7 900.

### 4. Сумка через плече з клапаном — 4 900 ₴ · `mens-bags`

Photos (7): IMG_0833, IMG_0839 (**hero**), IMG_0859, IMG_0866, IMG_0868, IMG_0884, IMG_0904.
Variants: темно-коричневий.

> Невелика горизонтальна сумка з клапаном і тисненням BÁLIER — для телефону, гаманця і ключів,
> коли кишень не вистачає, а рюкзак завеликий. Носиться через плече на регульованому ремені або
> в руці за коротку ручку.

Details: Клапан на магнітах [уточнити] · Регульований ремінь · Коротка ручка · Тиснення логотипа

Price: the brand's own Space chest bag is 4 800; same class. 4 900.

### 5. Сумка-месенджер з клапаном — чорна · 5 400 ₴ · `mens-bags`

Photos (14): IMG_6693 (**hero**), 6694, 6695, 6696, 6697; PXL_20251111_111511706, 111544438,
111649995, 111732750, 111748815, 112123732, 112144147, 112207100, 112216909 (studio, in box).
Variants: чорний.

> Вертикальний месенджер у гладкій чорній шкірі. Під клапаном — кишеня на блискавці, всередині
> — основне відділення і кишені для карток [уточнити]; клапан тримається на двох магнітах.
> Широкий текстильний ремінь [уточнити] з регулюванням — на плече або через груди.

Details: Клапан на двох магнітах · Кишеня на блискавці під клапаном · Регульований ремінь ·
Формат А5 [уточнити]

Price: between №4 and №6 by size. 5 400.

### 6. Сумка через плече на блискавці — чорна · 5 200 ₴ · `mens-bags` · featured

Photos (9): IMG_6285, 6287, 6288, 6290, 6293, 6296 (**hero**), 6297, 6298, 6299.
Variants: чорний.

> Вертикальна сумка через плече з фактурної шкіри: зовнішня кишеня на блискавці спереду, основне
> відділення на блискавці зверху, шкіряний ремінь з карабінами. Достатньо для планшета
> [уточнити] і всього щоденного.

Details: Фактурна шкіра · Дві блискавки · Знімний ремінь на карабінах

Price: same class as Space (4 800), larger. 5 200. IMG_6290 also shows №7 next to it —
usable on both pages.

### 7. Клатч-барсетка з ремінцем — чорна · 3 600 ₴ · `mens-bags`

Photos (6): IMG_0940, IMG_0969 (**hero**), IMG_0984, IMG_0993, IMG_1001, IMG_1155.
Variants: чорний.

> Барсетка на дві блискавки в гладкій чорній шкірі: одне відділення під телефон і гаманець,
> друге — під дрібниці. Ремінець на зап'ястя, який знімається, якщо сумку кладуть у портфель.

Details: Дві блискавки · Знімний ремінець на зап'ястя · Гладка шкіра

Price: BlankNote's small crossbodies 2 400–3 500; this is thicker leather and a men's cut.
3 600.

### 8. Рюкзак — 8 900 ₴ · `backpacks-travel` · featured

Photos (11): PXL_20260110_175423738 (**hero**), 175434314, 175524873, 175551475, 175601714,
175614466, 175755320, 175831333 (чорний); 184439872, 185617641, 185648370 (group shots —
three colours and two sizes together).
Variants: чорний, темно-коричневий, коричневий. **Sizes: the group shots show a smaller
backpack next to the regular one** — either a second product «Міні-рюкзак» (proposed
6 900 ₴) or a size option; the panel has colour variants, not size variants, so a second
product is the clean answer. `[уточнити]`

> Міський рюкзак з фактурної шкіри, який не боїться дощу і щоденного метро. Основне відділення
> на блискавці, зовнішня кишеня спереду, м'яка спинка і широкі шкіряні лямки з регулюванням.
> Всередині — кишеня для ноутбука [уточнити].

Details: Фактурна шкіра · Регульовані шкіряні лямки · Зовнішня кишеня · Три кольори

Price: BlankNote men's Foster 8 250, brand backpacks 6–7.5 k. 8 900.

### 9. Сумка на плече — 5 500 ₴ · `womens-bags` · featured

Photos (14): PXL_20251219_083512555, 083540600, 083545985, 083607079, 090521898 (**hero**,
чорний), 090548089; 084231060, 084320183, 084610573, 084653641, 084708195, 084732299,
084740691, 084747587 (молочний).
Variants: чорний, молочний. **Assumption:** one model — the white one is shot with the short
handle, the black with the strap let out; if they are two models, split. `[уточнити]`

> Сумка на плече з гладкої шкіри у формі, яка не виходить з моди: чиста лінія, блискавка
> зверху, регульований ремінь — коротко на плече або довше через тіло. Всередині одна кишеня на
> блискавці [уточнити].

Details: Гладка шкіра · Регульований ремінь · Блискавка зверху · Два кольори

Price: the brand's Lunet is 5 500, BlankNote Tessa 5 220. 5 500. If Lunet *is* this bag,
keep the name.

### 10. Сумка-багет із замші — коричнева · 4 900 ₴ · `womens-bags`

Photos (5): PXL_20251227_112827031, 112902760, 112941165, 113823270 (**hero**), 113907362.
Variants: коричневий.

> Багет із м'якої замші кольору какао. Коротка ручка для руки і довгий ремінь через плече, одне
> відділення на блискавці. Замша — про дотик, тож ця сумка для сухих днів і вечорів.

Details: Замша · Дві ручки: коротка і довга · Блискавка зверху

Price: suede baguettes sit under smooth-leather bags of the same size. 4 900.

### 11. Сумка «Боулінг» з двома ручками — 5 900 ₴ · `womens-bags`

Photos (13): IMG_4298, 4299, 4300 (**hero**), 4301, 4302, 4305, 4307, 4309 (гладка шкіра,
шоколад); PXL_20260310_144424594, 144438393, 144447042, 144552140, 144557031 (нубук,
коричневий).
Variants: шоколад (гладка шкіра), коричневий (нубук). **Assumption:** one silhouette in two
leathers. `[уточнити]`

> Витягнута сумка з двома короткими ручками — на плече або в руку. Блискавка на всю довжину,
> всередині кишеня на блискавці [уточнити]; довгий ремінь у комплекті, щоб носити через тіло.

Details: Дві ручки + довгий ремінь · Блискавка на всю довжину · Гладка шкіра або нубук

Price: structured, two leathers, above №9. 5 900.

### 12. Шопер — чорний · 6 900 ₴ · `womens-bags`

Photos (5): IMG_4115, IMG_4242, IMG_4245, IMG_4247 (**hero**), IMG_4250.
Variants: чорний.

> Шопер з гладкої шкіри, в який входить ноутбук, планер і все, що зазвичай «не влазить». Довгі
> ручки на плече, тиснення BÁLIER, всередині кишеня на блискавці [уточнити].

Details: Формат А4 [уточнити] · Довгі ручки · Тиснення логотипа

Price: large smooth-leather tote, BlankNote laptop-class 8 580 → below it. 6 900.

### 13. Шопер із тисненням під пітона — графіт · 7 400 ₴ · `womens-bags` · featured

Photos (8): PXL_20260305_140406412, 140429936, 140527320, 140531002, 140722893, 140735307,
141920199, 141945496 (**hero**).
Variants: графіт.

> Той самий шопер у шкірі з тисненням під пітона кольору графіт — фактура, яку помічають.
> Ланцюжок на ручках, знімне дно [уточнити — на фото окрема панель із кнопками] і маленький
> гаманець-конверт у комплекті [уточнити].

Details: Тиснення під пітона · Ланцюжок · Знімне дно [уточнити] · Гаманець у комплекті [уточнити]

Price: embossed leather and extras over №12. 7 400.

### 14. Сумка для телефону — замша · 2 400 ₴ · `wallets`

Photos (3): PXL_20260110_181551634 (**hero**), 181613648, 181742426.
Variants: темно-коричневий.

> Замшева сумочка на телефон з плетеним шнуром замість ременя. Кишеня спереду на кнопках
> [уточнити] для картки й ключа. Для прогулянки, коли з собою має бути тільки телефон.

Details: Замша · Плетений шнур · Передня кишеня

Price: BlankNote Tina 2 370. 2 400.

### 15. Гаманець-конверт — 1 950 ₴ · `wallets` · featured

Photos (4): IMG_6309 (**hero**), IMG_6310, IMG_6311, IMG_6312 (усі три гаманці разом).
Variants: чорний.

> Довгий гаманець, складений як конверт — без жодної зайвої деталі зовні. Всередині відділи
> для купюр і карток [уточнити], відділ на блискавці.

Details: Формат конверта · Відділ на блискавці · Гладка шкіра

Price: the brand's existing wallet price. 1 950. Possibly *is* «Гаманець BÁLIER» 19×11 —
`[уточнити]`.

### 16. Портмоне з хлястиком на кнопці — 2 200 ₴ · `wallets`

Photos (7): IMG_6301 (**hero**), 6302, 6303, 6304, 6305, 6698, 6312.
Variants: чорний.

> Портмоне на хлястику з кнопкою: розгортається в довгий органайзер — відділи для карток, купюр,
> документів і монетниця на блискавці. Вміщує паспорт [уточнити].

Details: Хлястик на кнопці · Монетниця на блискавці · Відділи для карток і документів

Price: more leather and hardware than №15. 2 200.

### 17. Портмоне тревел на двох кнопках — 2 400 ₴ · `wallets`

Photos (2): IMG_6308 (**hero**), IMG_6312.
Variants: чорний.

> Портмоне на дві кнопки з відділом на блискавці посередині — для тих, хто носить дві валюти або
> багато карток. Розкривається плоско, лежить у внутрішній кишені пальта.

Details: Дві кнопки · Відділ на блискавці · Гладка шкіра

Price: the largest of the three. 2 400. One photo only — needs a closed-front shot.

### Brand assets in the folder, not products

`Balier logo чер.png`, `аватарар.png` and two more PNGs — the logo and the avatar. Useful for
the site header, the favicon and the OG image; not for the catalog.

### Not in the folder, but in the Instagram highlights

«Капці» (slippers) has a highlight of its own; no slipper is in the photo set. Either it is not
a launch product or the photos are elsewhere — `[уточнити]`.

## What only the client can fill

One row per product. Nothing below can be read from a photo, and the site shows dimensions on
every product page while Nova Poshta refuses a waybill without a weight.

| # | Product | Розміри (см) | Вага (г) | Шкіра / підкладка | Кольори у наявності | Назва (якщо є) |
|---|---|---|---|---|---|---|
| 1 | Дорожня сумка з ремінцями | | | | | |
| 2 | Дорожня «Бостон» | | | | | |
| 3 | Портфель для ноутбука | | | | | |
| 4 | Сумка з клапаном (горизонтальна) | | | | | |
| 5 | Месенджер з клапаном | | | | | |
| 6 | Сумка через плече на блискавці | | | | | |
| 7 | Клатч-барсетка | | | | | |
| 8 | Рюкзак (+ міні?) | | | | | |
| 9 | Сумка на плече | | | | | |
| 10 | Багет із замші | | | | | |
| 11 | «Боулінг» з двома ручками | | | | | |
| 12 | Шопер чорний | | | | | |
| 13 | Шопер під пітона | | | | | |
| 14 | Сумка для телефону | | | | | |
| 15 | Гаманець-конверт | | | | | |
| 16 | Портмоне з хлястиком | | | | | |
| 17 | Портмоне тревел | | | | | |

## How it gets loaded (once approved)

Not through the panel by hand — 17 products and 130 photos is an afternoon of clicking. The
repo already has the path: `scripts/test-catalog.ts` + `test-products/<folder>/` +
`pnpm media:ingest` + `pnpm db:seed`. The plan is to rewrite `TEST_PRODUCTS` from this file
(with variants per colour, which the seed does not do yet — small addition), lay the photos out
into folders by the mapping above (HEIC → JPEG/WebP at the L0 export size, 1080×1440), ingest
into R2 (needs the client's bucket — launch.md L2), and seed the production database once,
**with the synthetic Phase 1 products skipped**. The client then edits everything in the panel.

## Open questions

- The seven `[уточнити]` interior claims above — each is either confirmed or deleted from the
  copy; none ships as a guess.
- Whether Lunet / Space / «Гаманець BÁLIER» from the old seed are №9 / №6 / №15 under their
  real names.
- Instagram captions carry the brand's real names and current prices; the logged-out page
  shows neither. Reading them needs a logged-in session in the browser tab left open.

## Out of scope (for now)

- Engraving/embossing as a checkout option («Тиснення/Гравіювання» in the bio) — a personalised
  line item is Phase 6 work; for launch it is a sentence on the product page and a message to
  the manager.
- Slippers.
