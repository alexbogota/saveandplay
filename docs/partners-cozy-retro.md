# Партнёрки под аккаунты Cozy и Retro (подборка от 15 октября 2026)

Дополняет [partners.md](partners.md) (там §3а и «Не подавать» остаются в силе). Вернуться: [START.md](../START.md).

## Главное
- В Admitad тем «cozy» и «retro» нет. Открытый каталог (admitad.ru/store, 536 рекламодателей) делится на 6 широких категорий: путешествия, интернет-магазины, интернет-услуги, финансовые программы, онлайн-игры, мобильные. Программы подключаются по магазинам, а не по темам.
- Отдельных партнёрок «для cozy-игр» не нашёл. Cozy = те же магазины ключей (GOG, Kinguin, Loaded и другие), только другой подбор игр. Retro = магазины ретро-консолей плюс те же магазины ключей (классика).
- Открытый каталог не показывает ставки, полный каталог закрыт входом. Все ставки ниже из сторонних справочников (affi.io, UpPromote, LinkClicky, профили Awin) и могут быть устаревшими. Перед заявкой открыть Rules.

## Старт без новых заявок (поправка 15 октября, днём)
Первая версия этой записи советовала добавить аккаунты Cozy и Retro площадками в Admitad и подключать магазины заново. Это было лишним. Правильно так:
- Cozy и Retro стартуют на тех же магазинах, что уже работают: GOG (для Retro лучший, см. `channels.md` §7), IndieGala, Kinguin. Loaded одобрен, но на сайт ещё не подключён. Отличается только подборка игр: новый блок в `data/accounts.json` (копия блока `prices`, свои `subid`, `stores`, правила отбора), код не меняется.
- Ссылки в постах ведут на наш сайт, а не в магазины. Площадка в Admitad одна («Save and Play»), одобрения магазинов уже выданы для неё. Новые аккаунты различаются только меткой SubID (`bluesky-cozy`, `bluesky-retro`): по ней статистика Admitad покажет, какой аккаунт приносит клики. Та же логика, что у Tumblr (решение владельца 12 октября). Правила GOG, Kinguin и Loaded разрешают Bluesky (таблица в `partners.md` §3).
- Kinguin идёт по своим правилам (пометка Marketplace key, отдельный пост через день, `docs/decisions.md`): для Cozy и Retro начинать лучше с GOG.

## Расширение позже (не для старта)
Когда захочется больше магазинов, заявки подаются один раз, для сайта, а не для каждого аккаунта:
1. Awin (залог £5 возвращается с первой выплатой, вывод через Payoneer): один аккаунт открывает VG Corner, GoGameGeek, ModRetro, Eneba (ES/FR/IT).
2. Напрямую: Retro vGames, Anbernic (UpPromote), eBay Partner Network (все три уже в `partners.md` §3а).
3. Когда будет трафик: CJ (Fanatical), Amazon Associates.

## Новое, что нашлось 15 октября
| Магазин | Сеть | Ставка, cookie | Тема | Оговорки |
|---|---|---|---|---|
| Eneba | Admitad (Many GEOs), Awin (ES, FR, IT), Daisycon (INT) | Admitad 5%, 30 дней; Daisycon 5%, 60 дней | ключи | по affi.io в Admitad статус «Closed», Awin ES/FR/IT «Opened», Daisycon «Closed»; правила Admitad: купоны, реклама по бренду и Google Shopping запрещены |
| VG Corner (UK) | Awin | 5%, 30 дней | Retro | профиль Awin 126607: ретро-портативки и механические клавиатуры |
| ModRetro | Awin (US) | ставка не указана, 30 дней | Retro | профиль Awin 117351 (консоль Chromatic в стиле Game Boy, картриджи). В §3а «Не подавать» стоит «программы нет»: профиль на Awin есть, перепроверить при входе в Awin |
| GoGameGeek | Awin (US), FlexOffers, свой GoAffPro | 5–10% (FlexOffers), 30 дней | Retro и Cozy | см. §3а Б |
| Fanatical | CJ | по сторонним данным от 2 до 6%, 30 дней (одна страница пишет до 12%) | ключи | одна страница UpPromote пишет, что для соцсетей есть отдельный канал через Tapfiliate; у самой Fanatical не проверено |
| Gamesporium, GamersBase | Admitad | ставки не подтверждены | ключи | affi.io; GamersBase описан по-русски, перед заявкой проверить регион (правило «не брать магазины для СНГ») |

## Не подошло или не нашёл
- Instant Gaming: через Shopper.com, по сторонней странице соцсети и deeplink запрещены, ставка копеечная и в источнике противоречивая. Не подавать.
- Evercade (Blaze), Limited Run Games, Fangamer, 8BitDo, ZOOM Platform: публичной партнёрской программы не нашёл. Не выдумывать, при желании написать им.

## Что можно проверить позже (не срочно)
В кабинете Admitad (Программы) поискать «Eneba», «retro», «game» и посмотреть статус Eneba. Полный каталог открыт только после входа, пароль я не прошу.

## Что есть в скидках сейчас (проверка 15 октября, вечер)
Откуда: `data/deals.json` (43 игры: GOG 24, Kinguin 15, IndieGala 4) и файл ключей Kinguin из `saveandplay-feeds` (40 игр, из них на сайт попали 15). Жанров, тегов и года выхода в данных нет: разбивка ниже сделана по названиям, по моим знаниям (годы выхода тоже мои, не из данных). Цены взяты из файлов.

**Retro (GOG, без DRM, цена / старая цена):** System Shock: Enhanced Edition $1.99 / $9.99; Prince of Persia: The Sands of Time, Warrior Within, The Two Thrones по $1.99 / $9.99; SimCity 4 Deluxe Edition $4.99 / $19.99; Syberia II $2.59 / $12.99; RollerCoaster Tycoon 3: Complete Edition $4.99 / $19.99; FlatOut 2 $1.99 / $9.99; Homeworld Remastered Collection $5.25 / $34.99. В старом стиле (новые игры): Legend of Grimrock $2.99 и Legend of Grimrock 2 $4.79, Hotline Miami $1.99. IndieGala (ключ Steam, не DRM-free): MARVEL vs. CAPCOM Fighting Collection: Arcade Classics $15.99 / $49.99, акция до 16 октября.

**Cozy:** на GOG и IndieGala по-настоящему уютных игр сейчас нет. Ближе всего «спокойные» игры в файле Kinguin (цена ключа / цена Steam): Farming Simulator 22 $6.89 / $19.99; Farming Simulator 19 $7.48 / $17.99; Supermarket Simulator $9.73 / $19.99; Planet Zoo $9.66 / $44.99; Euro Truck Simulator 2 $10.61 / $19.99; American Truck Simulator $9.02 / $19.99; Cities: Skylines $8.03 / $29.99. На сайте из них сейчас только Euro Truck Simulator 2 и Cities: Skylines (остальные не влезли в лимит 15 ключей Kinguin).

**Почему так мало Cozy:** отбор настроен на хиты. GOG: старая цена от $9.99, минимум 300 отзывов, читаются только 3 страницы самых продаваемых скидок, не больше 24 игр (`data/deals-rules.json`). Дешёвая классика и инди-«уют» под эти условия не попадают. Kinguin: только игры дороже $8 в Steam с 500 и больше отзывов.
