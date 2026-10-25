## Тема
Как читать историю цен игры. Выбрана как вечная тема: темы про бандлы Humble из брифа уже закрыты гидом про бандлы. Берёт нашу собственную историю цен как пример, плюс правила Steamworks и FAQ SteamDB.

## Откуда цифры и факты
- Control Ultimate Edition: цена $5.99, «was» $39.99, 15 записей с 2026-10-05 по 2026-10-25, пропуск 8–12 октября (записи 5, 7, 13–25 октября): `data/history.json`, ключ `gog-control-ultimate-edition`. 21 день = с 5 по 25 октября включительно.
- Цитаты «in reference to a base price that has been in place for at least 30 days» (это пересказ страницы), «cannot be discounted within 30 days of another discount», «cannot run shorter than 1 day or longer than 14 days», «Decreasing a product's base price doesn't generate a 30-day cooldown on future discounts», «may display differently to customers in different parts of the world, per local laws»: https://partner.steamgames.com/doc/marketing/discounts
- SteamDB: «whatever price the Steam API returns as lowest», агрегированные USD-цены в некоторых регионах, флаг страны, данные IsThereAnyDeal до 2016 для US/UK/EU, дешёвый бандл как причина странной цены: https://steamdb.info/faq/

## Что проверить владельцу
- Страницы gg.deals (403) и IsThereAnyDeal (404) не открылись, про них в статье только это сказано. WebFetch отдаёт пересказ страницы, не дословный текст: цитаты стоит сверить глазами на странице Steamworks.
- Фраза «base price that has been in place for at least 30 days» в статье стоит в кавычках, но получена из пересказа: если на странице формулировка другая, убрать кавычки.
- Абзац про «sale again and again» в разделе «What a price chart shows» немного расплывчатый, можно упростить.

## Когда устареет
После изменения правил Steamworks; пример с Control описывает 5–25 октября 2026, цифры в нём не меняются.
