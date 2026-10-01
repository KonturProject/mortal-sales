/**
 * Serves game/dist the way GitHub Pages will: under a sub-path (http://127.0.0.1:8090/mortal-sales/), so that an absolute
 * URL in the build, which a root server would hide, shows up here. For checking a production build by hand:
 *
 *   npm run build && npm run serve-dist
 *   game  http://127.0.0.1:8090/mortal-sales/        admin  http://127.0.0.1:8090/mortal-sales/admin.html
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PREFIX = '/mortal-sales/';
const PORT = Number(process.env.PORT) || 8090;
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(PREFIX)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not under ${PREFIX} — like GitHub Pages, this site lives in a sub-folder.`);
        return;
    }
    const relative = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`dist on http://127.0.0.1:${PORT}${PREFIX}`));
