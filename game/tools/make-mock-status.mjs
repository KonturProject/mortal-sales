// Regenerates game/public/assets/mock/mock-status.json — the offline fixture the game shows while config.json
// has useMock: true — and apps-script/test/mock-roster.json, the roster the local mock backend starts with.
// Deterministic, so re-running it never changes the files without a reason. All names are INVENTED: the real
// employee list never goes into the repo (it is imported through the admin page).
// Run from game/:  node tools/make-mock-status.mjs
import { writeFileSync } from 'node:fs';

// Group sizes like the real ones: very different, which is exactly why fights use the average per employee.
const sizes = { 'СР1': 12, 'СР2': 9, 'СР3': 12, 'СР5': 16, 'СР6': 5, 'СР9': 11 };
const stars = { 'СР1': 5, 'СР2': 4, 'СР3': 4, 'СР5': 3, 'СР6': 5, 'СР9': 4 };

const surnames = ['Орлова', 'Белов', 'Громова', 'Лисицын', 'Соловьёва', 'Ковалёв', 'Рябова', 'Мельников', 'Зайцева', 'Прохоров',
    'Дроздова', 'Субботин', 'Журавлёва', 'Кабанов', 'Ширяева', 'Тарасов', 'Воронина', 'Гладков', 'Лукина', 'Фомин',
    'Яковлева', 'Борисов', 'Никитина', 'Сорокин', 'Ефимова', 'Данилов', 'Колесникова', 'Мартынов', 'Горбунова', 'Пестов',
    'Широкова', 'Лаптев', 'Беляева', 'Родионов', 'Тихомирова', 'Авдеев', 'Мясникова', 'Суханов', 'Блинова', 'Крюков',
    'Силина', 'Панин', 'Герасимова', 'Исаев', 'Козырева', 'Дорофеев', 'Назарова', 'Холодов', 'Левина', 'Жданов',
    'Маслова', 'Устинов', 'Комарова', 'Васильев', 'Поляковa', 'Евдокимов', 'Сидорова', 'Анисимов', 'Кулагина', 'Булатов',
    'Рогова', 'Щербаков', 'Миронова', 'Гусев', 'Артамонова'].map(s => s.replace('a', 'а'));
const given = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Ирина', 'Алина', 'Дарья', 'Юлия', 'Полина', 'Андрей', 'Кирилл', 'Никита'];
const patronymic = ['Сергеевна', 'Андреевна', 'Олеговна', 'Игоревна', 'Павловна', 'Алексеевна', 'Викторовна', 'Дмитриевна', 'Сергеевич', 'Андреевич'];

// Tiny deterministic generator (mulberry32).
let seed = 20260929;
const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = list => list[Math.floor(rand() * list.length)];

const roster = [];
const managers = [];
let n = 0;
for (const [rop, size] of Object.entries(sizes)) {
    for (let i = 0; i < size; i++) {
        const name = `${surnames[n]} ${pick(given)} ${pick(patronymic)}`;
        roster.push({ name, dept: rop });
        const day = Math.floor(rand() * rand() * 5); // mostly 0–2, now and then more
        const prior = 4 + Math.floor(rand() * 14);
        managers.push({ name, rop, day, period: prior + day });
        n++;
    }
}

const leaders = Object.keys(sizes).map(rop => {
    const own = managers.filter(m => m.rop === rop);
    return {
        rop,
        stars: stars[rop],
        staff: own.length,
        dayCount: own.reduce((sum, m) => sum + m.day, 0),
        periodCount: own.reduce((sum, m) => sum + m.period, 0),
    };
});

const after = Object.fromEntries(leaders.map(l => [l.rop, l.dayCount]));
const before = Object.fromEntries(leaders.map(l => [l.rop, Math.max(0, l.dayCount - 2)]));

const status = {
    ok: true,
    period: { id: 12, dayIndex: 2, daysTotal: 5, state: 'active' },
    pairs: [
        { id: 1, left: 'СР1', right: 'СР3' },
        { id: 2, left: 'СР2', right: 'СР5' },
        { id: 3, left: 'СР6', right: 'СР9' },
    ],
    leaders,
    managers,
    lastImport: { id: 7, at: '2026-09-29T12:05:00+03:00', before, after },
    lastUpdated: '2026-09-29T12:06:00+03:00',
};

writeFileSync(new URL('../public/assets/mock/mock-status.json', import.meta.url), JSON.stringify(status, null, 2) + '\n');
writeFileSync(new URL('../../apps-script/test/mock-roster.json', import.meta.url), JSON.stringify(roster, null, 2) + '\n');
console.log('written:', managers.length, 'managers;', leaders.map(l => `${l.rop}: ${l.dayCount}/${l.staff}=${(l.dayCount / l.staff).toFixed(2)}`).join('  '));
