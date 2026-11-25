#!/usr/bin/env python3
# Automatic videos for TikTok and YouTube Shorts: a plan (JSON) becomes one MP4, 1080x1920, 24 fps, with its own music.
# The plan lists the shots: a background (a picture or a clip from Higgsfield) and the text on it, in one of the styles of
# text.html (hook, step, drop, swap, stack, big, brand). See sample-plan.json. The brand end card is added when it is missing.
#   python3 render.py plan.json out.mp4              the whole video
#   python3 render.py plan.json chk --at 1.0,5.2     only these moments, as chk_<t>.jpg (for checking)
# Needs: ffmpeg, numpy, scipy, pillow, playwright (chromium), and the fonts in video/fonts (the workflow downloads them).
import io, json, os, subprocess, sys, hashlib, urllib.request
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 24
MIN = {'hook': 3.2, 'step': 3.5, 'drop': 4.6, 'swap': 3.2, 'stack': 3.6, 'big': 3.0, 'brand': 4.5}
MOVES = ('in', 'out', 'left', 'right', 'up', 'down', 'none')


def check(plan):
    """Cleans the plan: known styles and moves, sensible lengths, the brand card last. Returns the list of shots."""
    shots = []
    for s in plan.get('shots', [])[:10]:
        x = dict(s.get('text') or {}); st = x.get('style', 'none')
        if st not in MIN and st != 'none': raise ValueError('unknown text style: ' + st)
        bg = dict(s.get('bg') or {})
        if not bg.get('url'): raise ValueError('a shot has no background url')
        bg['kind'] = bg.get('kind') or ('clip' if bg['url'].split('?')[0].lower().endswith(('.mp4', '.mov', '.webm')) else 'image')
        bg['move'] = bg.get('move') if bg.get('move') in MOVES else ('none' if bg['kind'] == 'clip' else 'in')
        x['style'] = st
        shots.append({'bg': bg, 'text': x, 'dur': round(max(MIN.get(st, 2.5), min(8.0, float(s.get('dur') or 4))), 3)})
    if len(shots) < 2: raise ValueError('a video needs at least 2 shots')
    if shots[-1]['text']['style'] != 'brand':
        shots.append({'bg': dict(shots[-1]['bg'], move='out'), 'text': {'style': 'brand'}, 'dur': 5.0})
    total = sum(s['dur'] for s in shots)
    if not 12 <= total <= 60: raise ValueError(f'the video would be {total:.1f} s long (12 to 60 s)')
    return shots


def fetch(url):
    """A local path, or a download kept in video/cache (Higgsfield links last at least a week)."""
    if not url.startswith('http'): return url
    os.makedirs(f'{HERE}/cache', exist_ok=True)
    ext = os.path.splitext(url.split('?')[0])[1][:5] or '.bin'
    path = f'{HERE}/cache/{hashlib.sha1(url.encode()).hexdigest()[:16]}{ext}'
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 al-swati-video'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + '.part', 'wb') as f: f.write(r.read())
        os.replace(path + '.part', path)
    return path


def clip_frames(path, start, n):
    vf = f'scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},fps={FPS}'
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', str(start), '-i', path, '-vf', vf, '-frames:v', str(n), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    if not len(fr): raise ValueError('no frames in ' + path)
    return fr if len(fr) >= n else np.concatenate([fr, np.repeat(fr[-1:], n - len(fr), 0)])   # a short clip holds its last frame


def cover(im):
    """The 9:16 part of a picture, at its own resolution."""
    w, h = im.size
    if w / h > W / H: cw = h * W / H; return im.crop((int((w - cw) / 2), 0, int((w + cw) / 2), h))
    ch = w * H / W; return im.crop((0, int((h - ch) / 2), w, int((h + ch) / 2)))


def smooth(k): return k * k * (3 - 2 * k)


def moved(im, k, move):
    """Ken Burns: zoom in or out, or a slow pan or tilt at a fixed zoom. k runs from 0 to 1 over the shot."""
    w, h = im.size; e = smooth(k)
    z = {'in': 1 + .12 * e, 'out': 1.12 - .12 * e, 'none': 1.0}.get(move, 1.12)
    cw, ch = w / z, h / z
    span_x, span_y = (w - cw) / 2, (h - ch) / 2
    cx, cy = w / 2, h / 2
    if move == 'left': cx = w / 2 + span_x * (1 - 2 * e)
    if move == 'right': cx = w / 2 - span_x * (1 - 2 * e)
    if move == 'up': cy = h / 2 + span_y * (1 - 2 * e)
    if move == 'down': cy = h / 2 - span_y * (1 - 2 * e)
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return np.asarray(im.resize((W, H), Image.LANCZOS, box=box))


class Shot:
    def __init__(self, s, t0):
        self.s, self.t0, self.n = s, t0, int(round(s['dur'] * FPS))
        bg = s['bg']; path = fetch(bg['url'])
        if bg['kind'] == 'clip':
            self.frames = clip_frames(path, float(bg.get('start') or 0), self.n); self.im = None
        else:
            self.im = cover(Image.open(path).convert('RGB')); self.frames = None
        if s['text']['style'] == 'brand' and self.frames is not None:   # the end card sits on the clip's last frame
            self.im = Image.fromarray(np.array(self.frames[-1])); self.frames = None

    def background(self, i):
        k = i / max(1, self.n - 1); move = self.s['bg']['move']
        if self.frames is not None:
            f = self.frames[min(i, len(self.frames) - 1)]
            return f if move == 'none' else moved(Image.fromarray(np.array(f)), k * .5, move)   # gentle on clips
        return moved(self.im, k, move)


def layout(shots):
    t, out = 0.0, []
    for s in shots: out.append(t); t += s['dur']
    return out, t


class Renderer:
    def __init__(self, plan):
        self.shots = check(plan); self.starts, self.dur = layout(self.shots)
        self.p = sync_playwright().start()
        self.b = self.p.chromium.launch(args=['--allow-file-access-from-files'])
        self.pg = self.b.new_page(viewport={'width': W, 'height': H})
        self.pg.goto('file://' + HERE + '/text.html')
        info = self.pg.evaluate('p => setup(p)', {'shots': self.shots})
        self.hits, self.words = info['hits'], info['words']
        self.rng = np.random.default_rng(3); self.shake_cache = {}
        self.cache = {}

    def shot(self, j):
        if j not in self.cache: self.cache = {j: Shot(self.shots[j], self.starts[j])}
        return self.cache[j]

    def shake(self, T):
        off = np.zeros(2)
        for h in self.hits:
            d = T - h
            if 0 <= d < .22:
                key = (h, int(d * FPS))
                if key not in self.shake_cache: self.shake_cache[key] = self.rng.uniform(-1, 1, 2)
                off += self.shake_cache[key] * 9 * (1 - d / .22)
        return off

    def frame(self, j, i):
        sh = self.shot(j); T = sh.t0 + i / FPS
        out = sh.background(i).astype(np.float32)
        self.pg.evaluate(f'render({T:.5f})')
        ov = np.asarray(Image.open(io.BytesIO(self.pg.screenshot(omit_background=True, type='png'))).convert('RGBA')).astype(np.float32)
        a = ov[..., 3:4] / 255; out = out * (1 - a) + ov[..., :3] * a
        if j > 0 and i < 6:   # the cut: a quick zoom punch and a light flash
            k = i / 6; z = 1.08 - .08 * (1 - (1 - k) ** 3)
            out = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR,
                  box=((W - W / z) / 2, (H - H / z) / 2, (W + W / z) / 2, (H + H / z) / 2))).astype(np.float32)
            if i < 3: out += (255 - out) * .35 * (1 - i / 3)
        dx, dy = self.shake(T)
        if dx or dy: out = np.roll(out, (int(round(dy)), int(round(dx))), (0, 1))
        if T > self.dur - .35: out *= max(0.0, (self.dur - T) / .35) * .6 + .4   # soft end, so the loop restarts cleanly
        return np.clip(out, 0, 255).astype(np.uint8)

    def at(self, T):
        j = max(k for k, s in enumerate(self.starts) if s <= T + 1e-6)
        return self.frame(j, min(self.shot(j).n - 1, int(round((T - self.starts[j]) * FPS))))

    def video(self, out, work):
        os.makedirs(work, exist_ok=True); parts = []
        for j, s in enumerate(self.shots):
            sh = self.shot(j); tmp, part = f'{work}/shot_{j}.tmp.mp4', f'{work}/shot_{j}.mp4'
            ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                   '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', tmp], stdin=subprocess.PIPE)
            for i in range(sh.n): ff.stdin.write(self.frame(j, i).tobytes())
            ff.stdin.close()
            if ff.wait() != 0: raise RuntimeError('ffmpeg failed on shot %d' % j)
            os.replace(tmp, part); parts.append(part); print('shot', j, s['text']['style'], sh.n, 'frames', flush=True)
        with open(f'{work}/list.txt', 'w') as f: f.writelines(f"file '{os.path.abspath(p)}'\n" for p in parts)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', f'{work}/list.txt', '-c', 'copy', f'{work}/video.mp4'], check=True)
        sys.path.insert(0, HERE); import audio
        audio.make([(s['text']['style'], t0, s['dur'], nw) for s, t0, nw in zip(self.shots, self.starts, self.words)], self.hits, self.dur, f'{work}/sound.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{work}/video.mp4', '-i', f'{work}/sound.wav', '-map', '0:v', '-map', '1:a',
                        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out + '.tmp.mp4'], check=True)
        os.replace(out + '.tmp.mp4', out)
        return {'seconds': round(self.dur, 2), 'bytes': os.path.getsize(out)}

    def close(self):
        self.b.close(); self.p.stop()


if __name__ == '__main__':
    plan = json.load(open(sys.argv[1])); r = Renderer(plan)
    try:
        if '--at' in sys.argv:
            for T in map(float, sys.argv[sys.argv.index('--at') + 1].split(',')):
                Image.fromarray(r.at(T)).save(f'{sys.argv[2]}_{T}.jpg', quality=88)
        else:
            print(json.dumps(r.video(sys.argv[2], os.path.splitext(sys.argv[2])[0] + '_work')))
    finally:
        r.close()
