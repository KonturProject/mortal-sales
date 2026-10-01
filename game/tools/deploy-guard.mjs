// Refuses to deploy unless this checkout has its own git remote that is NOT the original
// "sales-vs-dragon" game. This project started as a copy of that game; publishing from here
// to its repository would overwrite the live site.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = /sales-vs-dragon/i;

let url = '';
try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
    // no origin configured
}

if (!url) {
    console.error('deploy отключён: у репозитория нет remote "origin". Создайте новый репозиторий и добавьте его: git remote add origin <url>');
    process.exit(1);
}
if (FORBIDDEN.test(url)) {
    console.error(`deploy отключён: origin (${url}) — это репозиторий боевой игры «Отделы против дракона».`);
    process.exit(1);
}
