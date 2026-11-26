## Тема
Гид про то, как читать время окончания скидки и часовые пояса. Идея пришла из Black Friday в брифе: пересечения с другими гидами нет (проверил: про время окончания там только пара строк в гиде про раздачи). Возвраты в GOG и Epic сравнить не удалось: их страницы не открылись.

## Откуда цифры и факты
- «Offer ends on: 12/03/2026 09:59 EET», «Lowest price in the last 30 days before discount»: страница https://www.gog.com/en/game/this_war_of_mine (открыта 26 ноября 2026).
- `2026-12-03T09:59:00+02:00` (= 07:59 UTC 3 декабря): `data/deals.json`.
- Цитаты Steam («begin every Monday morning at 10AM Pacific time and run for 7 days», «rotate every day at 10am Pacific», «at 10am Pacific on the applicable day», «cannot run shorter than 1 day or longer than 14 days»): https://partner.steamgames.com/doc/marketing/discounts
- EET = UTC+2 зимой, Pacific = UTC−8 зимой и −7 летом, 10:00 Pacific = 18:00 UTC зимой: моя арифметика, не цитата.

## Что проверить владельцу
- Пересчёт Pacific в UTC и то, что EET на 2 часа впереди UTC, написаны не из источника, а из общих знаний; в тексте это отмечено.
- Страница Steam для разработчиков, не магазинная страница игры. В тексте так и сказано.
- Страница GOG показала «12/03/2026» неоднозначно; 3 декабря взято из нашего `deals.json`.

## Когда устареет
Примеры (дата 3 декабря 2026) перестанут быть актуальными после 3 декабря 2026. Сами правила устареют, если Steam или GOG поменяют расписание или вид страницы.
