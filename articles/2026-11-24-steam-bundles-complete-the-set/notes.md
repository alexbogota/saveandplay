## Тема
Гид про бандлы Steam: как работает «complete the set» и как возвращают бандлы. Взято из тем брифа про Black Friday (бандл Red Dead 1+2), но превращено в вечный гид. С гидом про бандлы Humble не пересекается: тот про уровни Humble, этот про правила Steam.

## Откуда цифры и факты
- Скидка процентом к каждому товару, которого нет у покупателя, до 95%, минимальная сумма, цитата «by applying a discount percentage»: https://partner.steamgames.com/doc/store/application/bundles (раздел Discount Rules).
- Complete the Set, цитата «as long as there is one or more item in the bundle they do not already have», подарки: та же страница.
- Must Purchase Together, цитата «can purchase this bundle only if they do not already have any of the products in the bundle»: та же страница.
- Возврат бандлов, цитата «You can receive a full refund for any bundle purchased on the Steam Store», суммарное время меньше двух часов, невозвратные DLC: https://store.steampowered.com/steam_refunds/ (Refunds on Bundles).
- Цифр из data/deals.json нет. Пример «играл три часа в одну игру» выдуман автором для объяснения, это не факт из источника.

## Что проверить владельцу
- Обе страницы открыты через WebFetch, который отдаёт краткий пересказ модели, а не полный текст. Цитаты лучше сверить глазами на страницах.
- Фразы «два человека видят разные суммы» и «цена покрывает только третью игру» это вывод автора из правила Complete the Set.
- Правила бандлов взяты из документации для разработчиков (Steamworks), на витрине формулировки могут отличаться.

## Когда устареет
Не устареет, пока Valve не меняет правила бандлов и возвратов.
