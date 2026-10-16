# Нишевые аккаунты (Cozy, Retro): как выбираются игры (15 октября 2026)

Вернуться: [START.md](../START.md). Решения и причины: конец [decisions.md](decisions.md). Спрос и партнёрки: [niche-demand-cozy-retro.md](niche-demand-cozy-retro.md), [partners-cozy-retro.md](partners-cozy-retro.md).

## Как это работает
1. Каждое утро в Update deals (после цен) программа `scripts/enrich-facts.mjs` дописывает в `data/game-facts.json` год, жанры и теги новых игр. Для GOG источник каталог GOG (год ОРИГИНАЛЬНОГО выхода), для остальных Steam. Вручную: `npm run facts`.
2. В блоке аккаунта (`data/accounts.json`) правило `select` говорит, какие игры ему подходят. Бриф берёт только их. Нет подходящей игры сегодня: файл поста пишет `NO POST TODAY` и причину (сколько подошло, сколько не подошло, сколько забрали другие аккаунты).
3. Одна игра в один день не идёт в разные аккаунты. Игру забирает тот, кто раньше стоит в `accounts.json` (сейчас: `prices`, `prices-kinguin`, `cozy`, `retro`). Исключение: аккаунты одной `family` (Nostr, Lemmy, Tumblr повторяют скидку дня основного аккаунта, у них `family: "prices"`).

## Правила сейчас
| Аккаунт | Магазины | Правило | Сегодня подходит |
|---|---|---|---|
| `cozy` (Bluesky `@cozygame.bsky.social`), включён | GOG, IndieGala | спокойные жанры (Cozy, Relaxing, Casual, Family Friendly, Building, City builder, Point&Click, Puzzle, Simulation и др.), без Action, Shooter, Horror, Violent, Gore, Survival, Fighting, Racing, Difficult, Dark и без mature | 4: Deponia, Syberia II, SimCity 4, RollerCoaster Tycoon 3 |
| `retro` (Bluesky `@retrogamedeals.bsky.social`), включён 16 октября, канал Mastodon выключен | GOG | игра вышла в 2007 году или раньше | 8: System Shock, Prince of Persia (3 части), SimCity 4, Syberia II, RollerCoaster Tycoon 3, FlatOut 2 |

Kinguin в эти аккаунты не входит (правило 11 октября: только `prices-kinguin`). Retro только GOG, потому что Steam показывает год переиздания, а не выхода. Порог 2007 выбран по данным (между 2006 и 2008 в списке пусто; Dead Space 2008 и The Saboteur 2009 уже не ретро).

## Честно о Cozy
Настоящих уютных игр (теги Cozy, Relaxing, Farming) в скидках сейчас нет. Аккаунт получает «спокойные» игры, слово cozy в тексте поста не пишется. Тег `CozyGames` ставится только игре, у которой этот тег есть сама. Три из четырёх игр Cozy есть и в Retro: в один день игру получит один аккаунт. Пока скидок мало, одна и та же игра будет возвращаться через несколько дней (штраф за повтор мягкий, как у всех аккаунтов). Чтобы уютных игр стало больше, нужно расширять отбор в `data/deals-rules.json` (GOG: старая цена от $9.99 и топ продаж отсекают дешёвую классику и инди), это отдельное решение.

## Теги (замер `npm run tags:research`, Mastodon.social, 6 дней)
- Retro: `RetroGaming` (741, около 120 в день), `GameDeals` (79), `GOG` (30), у Mastodon ещё `DRMFree` (16), `RetroGames` (288) по очереди с `PCGaming` (725) и тегом игры.
- Cozy (Bluesky, до 4 тегов): всегда `GameDeals`, `PCGaming`; по игре: `PointAndClick` (31) для Deponia и Syberia II, `CityBuilder` (5) для SimCity 4 и RollerCoaster Tycoon 3, `CozyGames` (28) и `FarmingSim` (2) только если у игры есть эти теги; затем магазин или тег игры. `WholesomeGames` (0 использований) и `CasualGames` (2) убраны как пустые.

## Как добавить новую нишу
Скопировать блок `cozy` в `data/accounts.json`, поменять ключ, `name`, `handle`, `subid`, `stores`, `select` и теги. Кода менять не нужно. Включить: `enabled: true`. Правило `select` описано в поле `about` того же файла.

## Что осталось владельцу
Если нужен Mastodon для Retro: создать аккаунт и сказать мне, я включу канал `mastodon` в блоке `retro`. Страницы сайта `/cozy/` и `/retro/` и короткие адреса профилей: задание 2 в [tasks-cozy-retro-claudecode.md](tasks-cozy-retro-claudecode.md).
