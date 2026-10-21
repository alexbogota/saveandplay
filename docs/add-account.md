# Новый аккаунт Bluesky по схеме Cozy и Retro: что мы сделали и как добавить ещё один

Записано 21 октября 2026. Назад: [START.md](../START.md). Как выбираются игры для ниши: [niche-accounts.md](niche-accounts.md). Утренний заход: [morning-saveandplay.md](morning-saveandplay.md).

## Что мы сделали (20–21 октября), в одном месте
1. Посты про скидки Bluesky публикует программа после «ок» владельца: `scripts/post-bluesky.mjs`, workflow «Post to Bluesky» (каждый час 07:07–18:07 по Боготе). Часы выкладки: `data/post-schedule.json` (первый сразу, второй через 3 часа, пост к гиду ещё через 3). Описание: `docs/posts-bluesky.md`.
2. Ответы под чужими постами отправляет программа после «ок»: `scripts/comments-drafts.mjs`, `scripts/comments-send.mjs`, workflow «Send comments», потолок 30 ответов в сутки на каждый аккаунт. Список постов для ответов делает GitHub каждые 6 часов («Comment candidates»). Описание: `docs/comments-saveandplay.md`.
3. Одна фраза «день saveandplay» = посты, гид и комментарии всех аккаунтов в одном сообщении, один «ок все». Чтение делает одна команда `scripts/morning.mjs` (тест `npm run morning:test`). Шаги и сжатые правила ответов лежат в навыке `saveandplay-morning` (сохранён 21 октября).
4. Cozy и Retro работают по той же схеме, каждый под своим паролем приложения Bluesky.
Записи решений: конец `docs/decisions.md` (20–21 октября).

## Как добавить новый аккаунт (чек-лист)
Всё читает «день saveandplay» само: `morning.mjs` берёт КАЖДЫЙ включённый блок из `data/comments-accounts.json`. Кода менять не нужно, кроме пункта 5.
1. Владелец: создать аккаунт в Bluesky, в Settings → Privacy and security → App passwords сделать пароль приложения и положить на GitHub в секрет `BSKY_APP_PASSWORD_<ИМЯ>` (Settings → Secrets and variables → Actions). Пароль в чат не присылать.
2. `data/accounts.json`: скопировать блок `cozy`, поменять ключ, `name`, `handle`, `subid`, `stores`, `select` (какие игры подходят), теги, `channels.bluesky.utmSource`, `channels.bluesky.publish.passwordEnv` = `BSKY_APP_PASSWORD_<ИМЯ>`. Порядок блоков = очередность при выборе игры (одна игра в день идёт одному аккаунту). Включить: `enabled: true`.
3. `data/comments-accounts.json`: скопировать блоки `cozy` и `cozy-wide`, поменять ключи, `handle`, `groups` (поисковые фразы ниши), `send+.passwordEnv`. У `-wide` поставить `extends` на новый блок и `shownAs` на его ключ.
4. Голос ответов: скопировать `docs/comments-cozy.md` в `docs/comments-<имя>.md` и переписать «Voice», «Rules», «Examples».
5. ДЫРА (ручной шаг, надо закрыть кодом при втором аккаунте): имя секрета нового пароля перечислено по одному в `.github/workflows/post-bluesky.yml` и `.github/workflows/comments-send.yml` (строки `BSKY_APP_PASSWORD_COZY: ${{ secrets... }}`). Для нового аккаунта добавить такую строку в оба файла. Лучше один раз сделать общий секрет-список, тогда новые аккаунты не будут трогать workflow.
6. Навык `saveandplay-morning`: в раздел «Per account» добавить строку голоса нового аккаунта и его id в шаг 4 (через propose_skills, целиком, сначала прочитать текущий файл).
7. Проверка: `npm run posts:test`, `npm run comments:test`, `npm run bskyposts:test`, `npm run morning:test`; пробная выкладка без публикации: `gh workflow run "Post to Bluesky" -R alexbogota/saveandplay --ref main -f dry_run=true`. Потом запись в `docs/decisions.md` и строка в `START.md`.
8. Первое утро новый аккаунт идёт под присмотром владельца: смотрим, что пост и ответы встали правильно.

Не проверено на практике: пункты 3 и 5 описаны по тому, как устроены Cozy и Retro, новый аккаунт этим путём ещё не добавляли.
