import heroRoster from '../config/heroRoster.json';
import ropMapping from '../config/ropMapping.json';
import heroMoves from '../config/heroMoves.json';
import { HeroSlug } from '../core/Constants';

export interface HeroDef {
    slug: HeroSlug;
    sprite: string;
    /** Mascot name shown on the HUD (the sheet may override it with the leader's own name). */
    name: string;
    color: string;
    /** How many legacy `<sprite>_hit1..N` attack-pose textures exist for this hero. */
    hits: number;
}

/** Every move a hero can have art for; a move without art is played as a plain tween instead. */
export const MOVES = ['attack', 'kick', 'heavy', 'hurt', 'stun', 'knockdown', 'fly', 'ko', 'win'] as const;
export type Move = typeof MOVES[number];

interface MovesManifest {
    heroes: Record<string, { moves?: Partial<Record<Move, string[]>>; left?: string[] }>;
}

const heroes = heroRoster.heroes as HeroDef[];
const mapping = ropMapping.mapping as Record<string, HeroSlug>;
const manifest = heroMoves as unknown as MovesManifest;

const reverseMapping: Partial<Record<HeroSlug, string>> = {};
for (const [ropName, slug] of Object.entries(mapping)) {
    reverseMapping[slug] = ropName;
}

/** Texture keys of one move, in the order they are used round-robin: legacy hit poses first (attacks only), then whatever the manifest lists. */
function poolFor(def: HeroDef, move: Move): string[] {
    const keys: string[] = [];
    if (move === 'attack') for (let i = 1; i <= def.hits; i++) keys.push(`${def.sprite}_hit${i}`);
    for (const key of manifest.heroes[def.slug]?.moves?.[move] ?? []) if (!keys.includes(key)) keys.push(key);
    return keys;
}

export const RosterConfig = {
    heroes,

    /** Returns the hero slug for a department code, or null if unmapped. */
    heroSlugForRop(ropName: string): HeroSlug | null {
        return mapping[ropName] ?? null;
    },

    heroDef(slug: HeroSlug): HeroDef | undefined {
        return heroes.find(h => h.slug === slug);
    },

    /** Every department code that has a hero, in roster order. */
    ropCodes(): string[] {
        return heroes.map(h => reverseMapping[h.slug]).filter((rop): rop is string => !!rop);
    },

    /** Texture keys for a move (they may not all exist — check `scene.textures.exists`). */
    poseKeys(slug: HeroSlug, move: Move): string[] {
        const def = heroes.find(h => h.slug === slug);
        return def ? poolFor(def, move) : [];
    },

    /** Keys that also have a hand-drawn left-facing `<key>_L` texture (used instead of mirroring on the right side). */
    leftVariantKeys(slug: HeroSlug): string[] {
        return manifest.heroes[slug]?.left ?? [];
    },

    /** Everything the preloader should try to load for a hero: standing pose, every move pose, and left variants. */
    textureKeys(slug: HeroSlug): string[] {
        const def = heroes.find(h => h.slug === slug);
        if (!def) return [];
        const keys = new Set<string>([def.sprite]);
        for (const move of MOVES) for (const key of poolFor(def, move)) keys.add(key);
        for (const key of manifest.heroes[slug]?.left ?? []) keys.add(`${key}_L`);
        return [...keys];
    },
};
