## Тема
Гид про демо Steam и Next Fest: что такое демо, когда Next Fest, что может исчезнуть, 5 проверок. Взято из тем брифа №4 (Steam Next Fest, демо). Не устаревает быстро: Next Fest повторяется три раза в год.

## Откуда цифры и факты
- Демо бесплатно, отдельный App ID, ссылка на полную игру, видимость как у бесплатных игр, нет матчмейкинга демо/полная игра, достижения лучше отключать, сохранения через облако полной игры, деактивация, работа вне Steam, одноразовое уведомление вишлиста в течение 14 дней: https://partner.steamgames.com/doc/store/application/demos
- Next Fest три раза в год; 19–26 октября 2026, 22 февраля – 1 марта 2027, 14–21 июня 2027; цитаты «a multi-day celebration where fans can try out demos» и «Upcoming (unreleased) games with a playable demo are eligible to participate»: https://partner.steamgames.com/doc/marketing/upcoming_events
- Демо не обязаны оставаться после Fest; цитаты «consider leaving your demo up beyond the conclusion» и «it's up to you to decide what works best for your release strategy»; просьба предупреждать игроков о деактивации: https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest
- Цен и скидок из data/deals.json в тексте нет. Число 5 в «5 проверок» это число пунктов списка.

## Что проверить владельцу
- Страницы Steamworks читались через WebFetch (пересказ маленькой моделью), поэтому цитаты стоит сверить с оригиналом, особенно «so that they can try before they buy» и «is a separate App ID that is associated with your full game's App ID».
- «Нет второго уведомления» это вывод из правила «один раз за 14 дней».
- «Не обещают вернуть демо» это моя формулировка: страницы об этом не говорят.

## Когда устареет
После 1 марта 2027 (даты Next Fest сдвинутся). Слово «now» верно до 26 октября 2026.
