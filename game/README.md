# game/

Vite-проект Mortal Sales: игра (`index.html`, `src/`) и админка (`admin.html`, `src-admin/`). Описание проекта и документация — в [корневом README](../README.md) и [docs/](../docs/README.md).

| Команда | Что делает |
|---|---|
| `npm run dev` | дев-сервер на `http://127.0.0.1:8080` |
| `npm run build` | продакшн-сборка в `dist/` (две страницы: игра и админка) |
| `npm run serve-dist` | отдаёт `dist/` из подпапки `/mortal-sales/`, как GitHub Pages |
| `npm run mock-backend` | локальный бэкенд (настоящий `Code.gs` на имитации Google), PIN `1234` |
| `npm run test:fight` | тесты боя, разбора файлов и логики игры |
| `npm run test:backend` | тесты бэкенда |
| `npm run deploy` | сборка и публикация в `gh-pages` (защищено `tools/deploy-guard.mjs`: нужен собственный `origin`) |

Проверка типов: `npx tsc --noEmit -p tsconfig.json`. Лицензия шаблона Phaser — в `LICENSE`.
