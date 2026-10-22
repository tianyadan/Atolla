#!/usr/bin/env python3
"""Generate Atolla jelly avatar animation sprites (backup, not for repo yet)."""
from PIL import Image
import math, json, os, colorsys

CELL = 16
FRAMES = 8
COLORS = [
    ('orange', 24), ('yellow', 46), ('blue', 212),
    ('green', 140), ('purple', 262), ('red', 352),
]
# Final 7 actions (product list)
ACTIONS = ['idle', 'typing', 'sleep', 'eat', 'alert', 'error', 'celebrate']

def pal(h):
    def c(s, l):
        r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
        return (int(r * 255), int(g * 255), int(b * 255), 255)
    return {
        'o': c(.65, .22), 'b': c(.70, .50), 'm': c(.80, .66),
        'h': c(.85, .82), 'w': (255, 250, 245, 255),
        'E': (30, 22, 44, 255), 'r': c(.9, .80),
        't': c(.70, .55), 'T': c(.6, .40),
        'x': (0, 0, 0, 0),
        # sleep closed eyes
        'z': c(.55, .35),
        # food / sparkle
        'f': (255, 220, 120, 255), 'F': (255, 180, 60, 255),
        's': (255, 255, 200, 255),
        # darker for error
        'd': c(.45, .28), 'D': c(.40, .18),
    }

# Base bell templates (14 wide, drawn into 16)
BELL = [
"....oooooo....",
"..oohhwmmmoo..",
".ohhwmmmmmmbo.",
".ohmmmmmmmmbo.",
"ommmmmmmmmmbbo",
"ommEmmmmEmmbbo",
"omrmmmmmmrbbbo",
"obbbbbbbbbbbbo",
"oobobobobobooo",
]
BELL_SQUASH = [
"..............",
"....oooooo....",
"..oohhwmmmoo..",
".ohhwmmmmmmbo.",
"ommmmmmmmmmbbo",
"ommEmmmmEmmbbo",
"omrmmmmmmrbbbo",
"obbbbbbbbbbbbo",
"oobobobobobooo",
]
BELL_SLEEP = [
"....oooooo....",
"..oohhwmmmoo..",
".ohhwmmmmmmbo.",
".ohmmmmmmmmbo.",
"ommmmmmmmmmbbo",
"ommzzzzzzmmbbo",  # closed eyes as dashes via z pixels
"omrmmmmmmrbbbo",
"obbbbbbbbbbbbo",
"oobobobobobooo",
]
BELL_SLEEP_SQUASH = [
"..............",
"....oooooo....",
"..oohhwmmmoo..",
".ohhwmmmmmmbo.",
"ommmmmmmmmmbbo",
"ommzzzzzzmmbbo",
"omrmmmmmmrbbbo",
"obbbbbbbbbbbbo",
"oobobobobobooo",
]

def put(px, x, y, color, W, H):
    if 0 <= x < W and 0 <= y < H and color[3] > 0:
        px[x, y] = color

def draw_bell(px, ox, oy, P, bell, W, H):
    for y, row in enumerate(bell):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            if ch == 'z':
                # closed eye: short horizontal line
                if x in (5, 6, 8, 9):
                    put(px, ox + x, oy + y, P['E'], W, H)
                else:
                    put(px, ox + x, oy + y, P['m'], W, H)
            elif ch in P:
                put(px, ox + x, oy + y, P[ch], W, H)

def draw_tentacles(px, ox, oy, P, f, action, squash, W, H):
    top = oy + 9
    bases = [3, 6, 9, 11]
    lengths = {
        'idle': [4, 5, 5, 4],
        'typing': [4, 5, 5, 4],
        'sleep': [3, 4, 4, 3],
        'eat': [4, 5, 5, 4],
        'alert': [4, 5, 5, 4],
        'error': [2, 3, 3, 2],
        'celebrate': [5, 6, 6, 5],
    }[action]
    for k, bx in enumerate(bases):
        L = lengths[k] - (1 if squash else 0)
        L = max(1, L)
        for j in range(L):
            if action == 'sleep':
                sw = int(round(math.sin(f * 0.35 + k) * 0.3 * (j > 1)))
            elif action == 'error':
                sw = int(round(math.sin(k * 2) * 0.2))  # limp, almost still
            elif action == 'celebrate':
                sw = int(round(math.sin(f * 1.2 + k * 1.7 - j * 0.8) * (1 + j * 0.35)))
            elif action == 'alert':
                sw = int(round(math.sin(f * 0.8 + k) * 0.4 * (j > 0)))
            else:
                sw = int(round(math.sin(f * 0.5 + k * 1.7 - j * 0.9) * 0.6 * (j > 1)))
            gx, gy = ox + bx + sw, top + j
            put(px, gx, gy, P['t'] if j < 2 else P['T'], W, H)

def draw_extras(px, ox, oy, P, f, action, W, H):
    """Action-specific props: food, zzz, sparkles, alert flash mark."""
    if action == 'eat':
        # food pellet approaches then vanishes into mouth area
        # frames 0-3: pellet from right; 4-5: at mouth; 6-7: gone / chew squash implied
        if f <= 3:
            fx = ox + 13 - f * 2
            fy = oy + 5
            put(px, fx, fy, P['F'], W, H)
            put(px, fx + 1, fy, P['f'], W, H)
        elif f <= 5:
            put(px, ox + 7, oy + 5, P['F'], W, H)
        # crumbs on 6
        if f == 6:
            put(px, ox + 5, oy + 4, P['f'], W, H)
            put(px, ox + 9, oy + 6, P['f'], W, H)
    elif action == 'sleep':
        # zzz rising, slow
        if f >= 2:
            zx = ox + 12
            zy = oy + 2 - (f - 2)
            if 0 <= zy:
                put(px, zx, zy, P['h'], W, H)
            if f >= 4:
                put(px, zx + 1, zy - 2, P['w'], W, H)
            if f >= 6:
                put(px, zx + 2, zy - 4, P['h'], W, H)
    elif action == 'alert':
        # small ping above on even frames
        if f % 2 == 0:
            put(px, ox + 7, oy + 0, P['w'], W, H)
            put(px, ox + 6, oy + 1, P['h'], W, H)
            put(px, ox + 8, oy + 1, P['h'], W, H)
    elif action == 'celebrate':
        # sparkles orbit
        for i, (sx, sy) in enumerate([(2, 1), (12, 2), (1, 8), (13, 7), (7, 0)]):
            if (f + i) % 3 != 0:
                put(px, ox + sx, oy + sy - (f % 2), P['s'] if i % 2 == 0 else P['f'], W, H)
    elif action == 'error':
        # tiny X or crack near eyes on mid frames
        if 2 <= f <= 5:
            put(px, ox + 4, oy + 4, P['D'], W, H)
            put(px, ox + 10, oy + 4, P['D'], W, H)

def frame_params(action, f):
    """Return (bell, squash, y_offset_in_cell). Offset baked lightly for sleep/error/celebrate."""
    if action == 'idle':
        return BELL, False, 0
    if action == 'typing':
        # jump: peak mid, squash land at 0 and 7
        if f in (0, 7):
            return BELL_SQUASH, True, 0
        if f in (3, 4):
            return BELL, False, -1  # peak — slight up shift in cell
        return BELL, False, 0
    if action == 'sleep':
        if f % 4 == 0:
            return BELL_SLEEP_SQUASH, True, 1
        return BELL_SLEEP, False, 1
    if action == 'eat':
        if f in (5, 6):
            return BELL_SQUASH, True, 0  # chew
        return BELL, False, 0
    if action == 'alert':
        # lean / bob toward user: slight up on flash frames
        return BELL, False, -1 if f % 2 == 0 else 0
    if action == 'error':
        return BELL, False, 1 + (1 if f >= 3 else 0)  # sink
    if action == 'celebrate':
        if f in (0, 7):
            return BELL_SQUASH, True, 0
        return BELL, False, -1 if f in (3, 4) else 0
    return BELL, False, 0

def draw_frame(P, action, f):
    im = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    px = im.load()
    bell, squash, yoff = frame_params(action, f)
    ox, oy = 1, 1 + yoff
    draw_bell(px, ox, oy, P, bell, CELL, CELL)
    draw_tentacles(px, ox, oy, P, f, action, squash, CELL, CELL)
    draw_extras(px, ox, oy, P, f, action, CELL, CELL)
    # error: darken whole sprite by blending toward dark
    if action == 'error':
        dark = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        dpx = dark.load()
        for y in range(CELL):
            for x in range(CELL):
                r, g, b, a = px[x, y]
                if a:
                    dpx[x, y] = (r * 55 // 100, g * 55 // 100, b * 55 // 100, a)
        im = dark
    return im

def sheet_for_color(name, h):
    P = pal(h)
    # one sheet: FRAMES cols × len(ACTIONS) rows
    rows = len(ACTIONS)
    im = Image.new('RGBA', (CELL * FRAMES, CELL * rows), (0, 0, 0, 0))
    for ri, action in enumerate(ACTIONS):
        for f in range(FRAMES):
            fr = draw_frame(P, action, f)
            im.paste(fr, (f * CELL, ri * CELL), fr)
    return im

def preview_gif(action, h=262, scale=6):
    P = pal(h)
    frames = []
    for f in range(FRAMES):
        fr = draw_frame(P, action, f)
        # pad dark bg
        bg = Image.new('RGB', (CELL, CELL), (14, 14, 30))
        bg.paste(fr, (0, 0), fr)
        frames.append(bg.resize((CELL * scale, CELL * scale), Image.NEAREST))
    path = f'previews/{action}.gif'
    dur = {
        'idle': 120, 'typing': 75, 'sleep': 180, 'eat': 90,
        'alert': 100, 'error': 110, 'celebrate': 80,
    }[action]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=dur, loop=0)
    return path

def main():
    os.makedirs('sprites', exist_ok=True)
    os.makedirs('previews', exist_ok=True)
    os.makedirs('config', exist_ok=True)

    # master config
    action_meta = {
        'idle': {
            'label': '漂浮',
            'row': 0,
            'loop': True,
            'fps': 8,
            'css': {'translateY': '±1cell', 'duration': '3s', 'easing': 'ease-in-out'},
            'trigger': 'state=idle',
            'notes': '空闲默认态；帧内触手轻摆，位移用 CSS',
        },
        'typing': {
            'label': '跳动/思考',
            'row': 1,
            'loop': True,
            'fps': 13,
            'css': {'translateY': '-3cell', 'duration': '0.6s', 'easing': 'ease-in-out'},
            'trigger': 'state=working|typing',
            'notes': '帧0/7落地压扁；模型排队与输出共用',
        },
        'sleep': {
            'label': '睡觉',
            'row': 2,
            'loop': True,
            'fps': 5,
            'css': {'translateY': '±0.5cell', 'duration': '4s', 'easing': 'ease-in-out'},
            'trigger': 'frontend: long idle auto; click to wake→idle',
            'notes': '闭眼 + zzz；触手垂短；点一下叫醒，不单独做 wake 文件',
        },
        'eat': {
            'label': '吃饭/喂食',
            'row': 3,
            'loop': False,
            'fps': 11,
            'css': None,
            'trigger': 'frontend: click feed once',
            'notes': '光点从旁飞入吞掉；播完回 idle；纯前端交互',
        },
        'alert': {
            'label': '等你拍板',
            'row': 4,
            'loop': True,
            'fps': 10,
            'css': {'opacity_flash': True, 'period': '0.7s'},
            'trigger': 'state=waiting (PR#2)',
            'notes': '头顶小闪点；可叠加透明度闪',
        },
        'error': {
            'label': '出错',
            'row': 5,
            'loop': False,
            'fps': 9,
            'css': {'translateY': '+1.5cell', 'filter': 'already baked darker in frames'},
            'trigger': 'state=error (PR#2)',
            'notes': '变暗下沉、触手耷拉；播完可定格末帧',
        },
        'celebrate': {
            'label': '庆祝',
            'row': 6,
            'loop': False,
            'fps': 12,
            'css': {'translateY': 'optional hop'},
            'trigger': 'task success | hire success',
            'notes': '转圈感靠触手甩 + 星星；播完回 idle',
        },
    }

    master = {
        'version': 2,
        'cell': CELL,
        'frames': FRAMES,
        'actions': ACTIONS,
        'action_meta': action_meta,
        'colors': {n: h for n, h in COLORS},
        'scales': [1, 2, 3],
        'sheet_layout': 'columns=frames, rows=actions in ACTIONS order',
        'usage': '备选素材，尚未写入 Atolla 仓库。前端接入时复制到 web/public/jelly-sprites/',
        'compat': {
            'jelly_color': ['orange', 'yellow', 'blue', 'green', 'purple', 'red'],
            'existing_pr4_rows': {'float': 'idle', 'jump': 'typing'},
        },
    }
    with open('config/animations.json', 'w') as f:
        json.dump(master, f, ensure_ascii=False, indent=2)

    # per-action config stubs (for jelly-animations/ files later)
    for a in ACTIONS:
        cfg = {
            'id': a,
            **action_meta[a],
            'sprite_row': action_meta[a]['row'],
            'frame_count': FRAMES,
            'cell': CELL,
            'files': {n: f'sprites/jelly-{n}@{{16,32,48}}.png' for n, _ in COLORS},
        }
        with open(f'config/{a}.json', 'w') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

    # sheets per color × scale
    for name, h in COLORS:
        sheet = sheet_for_color(name, h)
        for s, label in ((1, 16), (2, 32), (3, 48)):
            out = sheet.resize((sheet.width * s, sheet.height * s), Image.NEAREST)
            out.save(f'sprites/jelly-{name}@{label}.png')

    # also export per-action strip (all colors in one row of sheets? or purple preview)
    # contact sheet: all actions for purple @3x
    contact_rows = []
    P = None
    for a in ACTIONS:
        row_frames = [draw_frame(pal(262), a, f) for f in range(FRAMES)]
        row = Image.new('RGBA', (CELL * FRAMES, CELL), (0, 0, 0, 0))
        for f, fr in enumerate(row_frames):
            row.paste(fr, (f * CELL, 0), fr)
        contact_rows.append(row)
    contact = Image.new('RGBA', (CELL * FRAMES, CELL * len(ACTIONS)), (14, 14, 30, 255))
    # paste with purple on dark
    for i, row in enumerate(contact_rows):
        # composite onto dark
        bg = Image.new('RGBA', row.size, (14, 14, 30, 255))
        bg.paste(row, (0, 0), row)
        contact.paste(bg, (0, i * CELL))
    contact.resize((contact.width * 4, contact.height * 4), Image.NEAREST).save('previews/all-actions-purple@4x.png')

    for a in ACTIONS:
        preview_gif(a)

    print('OK', len(ACTIONS), 'actions ×', len(COLORS), 'colors')
    print('sprites:', len(os.listdir('sprites')))
    print('previews:', os.listdir('previews'))

if __name__ == '__main__':
    main()
