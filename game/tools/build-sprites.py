#!/usr/bin/env python
"""Builds the hero sprites in public/assets/sprites from the hand-finished PNGs in assets-source/character-refs.
Run from game/:  python tools/build-sprites.py [--only heroes cave] [--out DIR]

  heroes  character-refs/<hero>/  ->  hero_<name>.png (standing) + hero_<name>_hit1..N.png (attack poses);
          art added later lives in 'animation and new model/<hero>/' and is listed per hero in HEROES (a new standing
          sprite and/or further attack poses, appended after the old ones)
  cave    character-refs/фон.*     ->  bg_cave.jpg, the old placeholder background (the arena uses bg_arena.jpg, which is a
                                       plain copy of assets-source/new-game/backgrounds/arena.jpg — no processing)

Sources are already transparent (Photoshop cut-outs), so no background removal here — only: crop to alpha bbox,
put every pose of a hero at one common pixel scale, and downscale with LANCZOS to 2x the on-screen size (the game
renders the textures at scale 0.5 x lane scale). Extra poses (hurt, stun, knockdown, ko, win ...) are integrated by
hand — see assets-source/new-game/README.md.
"""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-source', 'character-refs')
NEW = os.path.join(ROOT, 'assets-source', 'animation and new model')
TEX = 2  # texture px per on-screen px (game renders at scale 1/TEX)

# folder prefix -> (slug, on-screen standing height px, scale factors of the 'анимация*' poses in character-refs,
#                   later art from NEW: 'stand' = a standing sprite that replaces the old one, 'extra' = [(file, factor)] more hit poses)
# Pose factors are relative to the standing sprite and were tuned by eye (poses are drawn at a smaller scale): the head /
# crown of a pose must come out the size of the standing one's — compare on a contact sheet before changing them.
HEROES = {
    'СР1':  ('hero_lion',     200, [1.50, 1.62, 1.35], {}),
    'СР2':  ('hero_scrooge',  190, [1.00], {'extra': [('Скрудж/animation 2.png', 1.95), ('Скрудж/animation 3.png', 1.95),
                                                      ('Скрудж/animation 4.png', 1.95)]}),
    # The Grinch in the pink robe (2026-10): his old poses show him without the robe, so only the new ones are used.
    'СР3':  ('hero_grinch',   205, [], {'stand': 'Гринч/new model.png',
                                        'extra': [('Гринч/animation 1.png', 2.0), ('Гринч/animation 2.png', 2.0), ('Гринч/animation 3.png', 2.0)]}),
    'СР 5': ('hero_yoda',     175, [1.60, 1.60, 1.60], {}),
    'СР6':  ('hero_neznaika', 195, [2.10, 2.10, 2.10], {}),
    'СР9':  ('hero_minion',   165, [1.00, 1.00, 1.00], {}),
}
BG_SIZE = (1280, 720)   # must equal GAME.WIDTH/HEIGHT in Constants.ts
BG_CROP_X = 380         # source-px offset of the crop window (cover-fit) of the old cave picture


def crop(im):
    a = np.array(im.getchannel('A'))
    ys, xs = np.where(a > 8)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def find(dirname, pred):
    d = os.path.join(SRC, dirname)
    hits = [f for f in sorted(os.listdir(d)) if pred(f.lower())]
    if not hits:
        raise SystemExit(f'no file in {dirname} matching predicate')
    return os.path.join(d, hits[0])


def folder(prefix):
    for n in sorted(os.listdir(SRC)):
        if n == prefix or n.startswith(prefix + ' ') or n.startswith(prefix + '-'):
            return n
    raise SystemExit('folder not found: ' + prefix)


def drop_stray(im):
    """The newer cut-outs carry a faint dark 'sticker' contour a few px away from the figure (alpha <= 120): invisible on
    white, a ghost outline on the dark arena. Clears faint dark pixels that are not within 4 px of the solid art; glows
    and motion trails are light-coloured and stay."""
    px = np.array(im)
    a = px[..., 3]
    solid = Image.fromarray(((a > 120) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    stray = (a > 0) & (a <= 120) & (px[..., :3].max(axis=2) < 80) & (np.array(solid) == 0)
    px[stray, 3] = 0
    return Image.fromarray(px, 'RGBA')


def resized(im, scale):
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    return im.resize((w, h), Image.LANCZOS)


def build_hero(out, prefix, slug, disp_h, factors, later):
    d = folder(prefix)
    if 'stand' in later:
        stand = crop(drop_stray(Image.open(os.path.join(NEW, later['stand'])).convert('RGBA')))
    else:
        stand = crop(Image.open(find(d, lambda f: f in ('персонаж.png',) or f.endswith('персонаж.png'))).convert('RGBA'))
    s = disp_h * TEX / stand.height
    resized(stand, s).save(os.path.join(out, slug + '.png'))
    poses = sorted(f for f in os.listdir(os.path.join(SRC, d)) if f.lower().startswith('анимация') and 'не трогать' not in f.lower())
    n = 0
    for i, f in enumerate(poses[:len(factors)]):
        pose = crop(Image.open(os.path.join(SRC, d, f)).convert('RGBA'))
        n += 1
        resized(pose, s * factors[i]).save(os.path.join(out, f'{slug}_hit{n}.png'))
    for f, factor in later.get('extra', []):
        pose = crop(drop_stray(Image.open(os.path.join(NEW, f)).convert('RGBA')))
        n += 1
        resized(pose, s * factor).save(os.path.join(out, f'{slug}_hit{n}.png'))
    print(slug, 'standing', stand.size, 'hit poses', n)








def build_background(out):
    """Cover-fits the cave picture to the game canvas (scale to canvas height, crop the sides)."""
    path = find_top(lambda f: f.startswith('фон'))
    im = Image.open(path).convert('RGB')
    scale = BG_SIZE[1] / im.height
    im = im.resize((round(im.width * scale), BG_SIZE[1]), Image.LANCZOS)
    x0 = min(max(0, round(BG_CROP_X * scale)), im.width - BG_SIZE[0])
    im.crop((x0, 0, x0 + BG_SIZE[0], BG_SIZE[1])).save(os.path.join(out, 'bg_cave.jpg'), quality=92)
    print('bg_cave.jpg', BG_SIZE, 'crop x0 =', x0, 'of', im.width)


def find_top(pred):
    for f in sorted(os.listdir(SRC)):
        if os.path.isfile(os.path.join(SRC, f)) and pred(f.lower()):
            return os.path.join(SRC, f)
    raise SystemExit('no top-level file in character-refs matching predicate')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'assets', 'sprites'))
    ap.add_argument('--only', choices=['heroes', 'cave'], nargs='+', help='rebuild only these parts')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    only = set(args.only or ['heroes'])
    if 'heroes' in only:
        for prefix, (slug, h, factors, later) in HEROES.items():
            build_hero(args.out, prefix, slug, h, factors, later)
    if 'cave' in only:
        build_background(args.out)
    print('done ->', args.out)
