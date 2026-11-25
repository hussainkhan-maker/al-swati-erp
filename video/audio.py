# Music and sound effects for the automatic videos, made here with numpy (no outside music, so no copyright claims).
# make(shots, hits, dur, out_wav): shots = [(style, start, length, words)], hits = text landings in seconds.
import wave
import numpy as np
from scipy.signal import lfilter

SR = 48000


def make(shots, hits, dur, out):
    N = int(SR * dur) + 1
    rng = np.random.default_rng(5)
    L = np.zeros(N); R = np.zeros(N)

    def add(sig, t0, gain=1.0, pan=0.0):
        i = int(t0 * SR); j = min(N, i + len(sig))
        if i < 0 or i >= N or j <= i: return
        s = sig[:j - i] * gain
        L[i:j] += s * np.sqrt((1 - pan) / 2) * 1.414; R[i:j] += s * np.sqrt((1 + pan) / 2) * 1.414

    def env(n, a, d):
        t = np.arange(n) / SR
        return np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)

    def lp(x, fc):
        a = np.exp(-2 * np.pi * fc / SR)
        return lfilter([1 - a], [1, -a], x)

    def hp(x, fc): return x - lp(x, fc)
    def noise(sec): return rng.standard_normal(int(sec * SR))

    def kick(gain=1.0):
        n = int(0.45 * SR); t = np.arange(n) / SR
        f = 45 + 95 * np.exp(-t / 0.035)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.16) * gain
    def hat(dec=0.04): x = hp(noise(0.12), 7000); return x * env(len(x), 0.001, dec) * 0.25
    def clap():
        x = hp(lp(noise(0.25), 6000), 900); e = env(len(x), 0.001, 0.07)
        for d in (0.012, 0.024): e[int(d * SR):] += 0.6 * env(len(x) - int(d * SR), 0.001, 0.05)
        return x * e * 0.35
    def boom(gain=1.0):
        n = int(1.4 * SR); t = np.arange(n) / SR
        s = np.sin(2 * np.pi * np.cumsum(32 + 70 * np.exp(-t / 0.08)) / SR) * env(n, 0.003, 0.45)
        return (s + lp(noise(1.4), 900) * env(n, 0.001, 0.08) * 0.35) * gain
    def clink(base=1250, gain=1.0):
        n = int(0.9 * SR); t = np.arange(n) / SR; s = np.zeros(n)
        for m, a, d in ((1.0, 1, .28), (2.76, .6, .18), (5.4, .35, .1), (8.9, .2, .06)): s += a * np.sin(2 * np.pi * base * m * t) * np.exp(-t / d)
        return s * 0.22 * gain
    def thud(gain=1.0):
        n = int(0.8 * SR); t = np.arange(n) / SR
        s = np.sin(2 * np.pi * (60 + 50 * np.exp(-t / 0.03)) * t) * env(n, 0.002, 0.18)
        return (s + lp(noise(0.8), 1500) * env(n, 0.001, 0.05) * 0.6) * gain
    def whoosh(sec, up=True, gain=1.0):
        x = noise(sec); k = np.linspace(0, 1, len(x))
        return hp(lp(x, 4000), 250) * (k ** 2 if up else np.sin(np.pi * k) ** 1.5) * 0.35 * gain
    def pop(f=660):
        n = int(0.25 * SR); t = np.arange(n) / SR
        return np.sin(2 * np.pi * f * t * (1 + 0.6 * np.exp(-t / 0.02))) * env(n, 0.001, 0.06) * 0.35
    def tick(): x = hp(noise(0.05), 2500); return x * env(len(x), 0.0005, 0.012) * 0.25
    def chime(f0=880):
        n = int(2.5 * SR); t = np.arange(n) / SR; s = np.zeros(n)
        for m, a in ((1, 1), (2, .4), (3, .2), (1.5, .3)): s += a * np.sin(2 * np.pi * f0 * m * t)
        return s * env(n, 0.003, 0.9) * 0.12

    # music bed: A minor pad and a bass pulse, 120 BPM; drums come in after the first shot
    t = np.arange(N) / SR
    chords = [(55.0, 110.0, 130.81, 164.81), (43.65, 87.31, 130.81, 174.61), (49.0, 98.0, 146.83, 196.0), (41.2, 82.41, 123.47, 164.81)]
    pad = np.zeros(N)
    for i in range(int(dur / 2) + 1):
        a, b = i * 2.0, min(dur, (i + 1) * 2.0); ia, ib = int(a * SR), int(b * SR)
        if ia >= N or ib <= ia: break
        seg = t[ia:ib] - a; ch = chords[i % 4]; s = np.zeros(ib - ia)
        for f in ch[1:]:
            for det in (-0.6, 0.6): s += np.sin(2 * np.pi * (f + det) * seg) + 0.25 * np.sin(2 * np.pi * 2 * (f + det) * seg)
        pad[ia:ib] += s * np.minimum(1, seg / 0.25) * np.minimum(1, (b - a - seg) / 0.25) * 0.033
        for k in range(8):
            tb = a + k * 0.25
            if 0.4 <= tb < dur - 0.6:
                n = int(0.22 * SR); tt = np.arange(n) / SR
                add(np.tanh(2 * np.sin(2 * np.pi * ch[0] * (2 if k % 4 == 3 else 1) * tt)) * env(n, 0.004, 0.09) * 0.2, tb)
    pad = lp(pad, 1800) * np.interp(t, [0, 0.3, dur - 0.8, dur], [0.5, 1, 1, 0.35]); L += pad; R += pad
    first = shots[1][1] if len(shots) > 1 else 3.5
    for k in range(int(dur / 0.5) + 1):
        tb = k * 0.5
        if 0.4 <= tb < dur - 0.5: add(kick(0.85), tb)
        if first <= tb < dur - 0.5: add(hat(), tb + 0.25, pan=0.3)
        if first <= tb < dur - 0.5 and k % 2 == 1: add(clap(), tb, pan=-0.1)

    # sound design, following each text style (same timings as text.html)
    add(boom(0.5), 0.05)
    for style, s0, ln, nw in shots:
        if s0 > 0: add(whoosh(0.45, True, 0.9), s0 - 0.3); add(boom(0.55), s0)
        if style == 'hook':
            for i in range(nw): add(whoosh(0.3, True, 0.6), s0 + 0.3 + i * .26 - .02, pan=(-1) ** i * .3)
            for k in range(30): add(tick(), s0 + 0.7 + nw * .26 + k * .03, 0.35, pan=-.5 + k * .03)
        if style in ('step', 'drop'):
            add(chime(660), s0 + .2); add(whoosh(0.5, False, 0.5), s0 + .55, pan=.4)
            for k in range(30): add(tick(), s0 + 1.0 + k * .03, 0.3, pan=.4 - k * .02)
        if style == 'step':
            for i in range(3): add(pop(620 - 100 * i), s0 + 1.6 + i * .25, .7)
        if style == 'drop':
            for i in range(nw): add(whoosh(0.35, False, 0.6), s0 + min(ln - 1.3, 2.2 + i * .25) - .05); add(clink(1400 + 200 * i, 0.5), s0 + min(ln - 1.3, 2.2 + i * .25) + .38)
        if style == 'swap':
            add(whoosh(0.25, True, 0.8), s0 + .95); add(pop(780), s0 + 1.5); add(chime(990), s0 + 1.85)
        if style == 'stack':
            for i, d in enumerate((.3, .75, 1.2)): add(pop(560 + 110 * i), s0 + d + .1, .45); add(thud(0.4), s0 + d + .3)
        if style == 'big':
            add(chime(784), s0 + .9)
        if style == 'brand':
            add(chime(660), s0 + 1.5); add(chime(990), s0 + 1.8)
            for i in range(4): add(pop(600 + 60 * i), s0 + 1.6 + i * .25, .35)
    for h in hits: add(thud(0.6), h)

    mix = np.stack([L, R], 1)
    mix = mix / max(1e-6, np.percentile(np.abs(mix), 99.95)) * 0.8
    mix = np.tanh(mix * 1.1) / np.tanh(1.1); mix *= 0.89 / np.max(np.abs(mix))
    f = int(0.6 * SR); mix[-f:] *= np.linspace(1, 0.15, f)[:, None]
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())
