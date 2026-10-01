/**
 * Local stand-in for the Apps Script backend: the real apps-script/Code.gs, run on in-memory fake
 * Google services (apps-script/test/gas-harness.mjs). For developing/testing the admin page and the
 * game without touching a real spreadsheet. It starts with the INVENTED roster of apps-script/test/mock-roster.json
 * (65 managers in six groups of the real sizes) and one import, so the screen is not empty.
 *
 *   npm run mock-backend                       -> http://127.0.0.1:8787/exec   (admin PIN 1234)
 *   game:  http://127.0.0.1:8080/?backend=http://127.0.0.1:8787/exec#key=mock-display-key-1234
 *   admin: http://127.0.0.1:8080/admin.html?backend=http://127.0.0.1:8787/exec
 *
 * (`?backend=` is honoured by dev builds only.) Everything is in memory: restart to reset.
 */
import http from 'node:http';
import fs from 'node:fs';
import { loadBackend } from '../../apps-script/test/gas-harness.mjs';

const PORT = Number(process.env.PORT) || 8787;
const PIN = '1234';
const DISPLAY_KEY = 'mock-display-key-1234';
const backend = loadBackend({ realClock: true, pin: PIN, displayKey: DISPLAY_KEY });

const roster = JSON.parse(fs.readFileSync(new URL('../../apps-script/test/mock-roster.json', import.meta.url), 'utf8'));
const seeded = backend.post({ action: 'importRoster', entries: roster });
if (!seeded.ok) throw new Error('mock roster refused: ' + JSON.stringify(seeded));

// A believable morning: a few invoices here and there (deterministic).
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
backend.post({
    action: 'importSnapshot',
    rows: roster.map(m => ({ name: m.name, count: Math.floor(rand() * rand() * 4) })),
});

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body) {
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
    }

    if (req.method === 'GET') {
        const key = new URL(req.url ?? '/', 'http://localhost').searchParams.get('key');
        send(res, 200, backend.get(key));
        return;
    }

    if (req.method === 'POST') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => send(res, 200, backend.postRaw(raw)));
        return;
    }

    send(res, 405, { ok: false, error: 'method_not_allowed' });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Mock backend on http://127.0.0.1:${PORT}/exec  (admin PIN ${PIN}, display key ${DISPLAY_KEY}, in-memory)`);
    console.log(`  game : http://127.0.0.1:8080/?backend=http://127.0.0.1:${PORT}/exec#key=${DISPLAY_KEY}`);
    console.log(`  admin: http://127.0.0.1:8080/admin.html?backend=http://127.0.0.1:${PORT}/exec`);
});
