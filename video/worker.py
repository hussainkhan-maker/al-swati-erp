#!/usr/bin/env python3
# Runs in the GitHub workflow "Video": first saves the blog pictures Claude made with Higgsfield (a 1600x900 JPEG in the public
# "blog" storage, on the post and its twin), then takes the next video plan from the "video" function, renders it and uploads it.
# GitHub signs a token for this run (OIDC); the function accepts only runs of video.yml on main of this repository.
import io, json, os, re, sys, traceback, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = open(os.path.join(HERE, '..', 'app', 'src', 'config.ts')).read()
URL = re.search(r'https://[a-z0-9]+\.supabase\.co', cfg).group(0)
ANON = re.search(r'SUPABASE_ANON_KEY = "([^"]+)"', cfg).group(1)


def oidc():
    req = urllib.request.Request(os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=al-swati-video',
                                 headers={'authorization': 'bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    return json.load(urllib.request.urlopen(req, timeout=30))['value']


def call(body):
    req = urllib.request.Request(URL + '/functions/v1/video', data=json.dumps(body).encode(), method='POST',
                                 headers={'authorization': 'Bearer ' + ANON, 'apikey': ANON, 'content-type': 'application/json', 'x-github-oidc': oidc()})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'video function {e.code}: {e.read().decode()[:300]}')


def pictures():
    from PIL import Image
    for p in call({'action': 'pic_claim'}).get('pictures') or []:
        try:
            req = urllib.request.Request(p['src'], headers={'user-agent': 'Mozilla/5.0 al-swati-blog'})
            im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=120).read())).convert('RGB')
            w, h = im.size   # the website shows blog pictures at 16:9
            if w / h > 16 / 9: cw = int(h * 16 / 9); im = im.crop(((w - cw) // 2, 0, (w + cw) // 2, h))
            else: ch = int(w * 9 / 16); im = im.crop((0, (h - ch) // 2, w, (h + ch) // 2))
            im = im.resize((1600, 900), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=84, optimize=True, progressive=True)
            up = call({'action': 'pic_upload', 'id': p['id']})
            urllib.request.urlopen(urllib.request.Request(up['url'], data=buf.getvalue(), method='PUT',
                                   headers={'content-type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': 'max-age=31536000'}), timeout=120).read()
            call({'action': 'pic_done', 'id': p['id'], 'ok': True, 'path': up['path']})
            print('picture saved', p['id'], len(buf.getvalue()) // 1024, 'KB', flush=True)
        except Exception as e:
            traceback.print_exc()
            call({'action': 'pic_done', 'id': p['id'], 'ok': False, 'error': f'{type(e).__name__}: {e}'[:400]})


def main():
    try: pictures()
    except Exception: traceback.print_exc()
    job = call({'action': 'claim'}).get('job')
    if not job:
        print('nothing to render'); return
    print('rendering', job['id'], flush=True)
    sys.path.insert(0, HERE); import render
    out = os.path.join(HERE, 'out.mp4')
    try:
        r = render.Renderer(job['plan'] or {})
        try: info = r.video(out, os.path.join(HERE, 'work'))
        finally: r.close()
        up = call({'action': 'upload_url', 'id': job['id']})['url']
        with open(out, 'rb') as f:
            req = urllib.request.Request(up, data=f.read(), method='PUT', headers={'content-type': 'video/mp4', 'x-upsert': 'true'})
        urllib.request.urlopen(req, timeout=300).read()
        call({'action': 'done', 'id': job['id'], 'ok': True, **info})
        print('done', info)
    except Exception as e:
        traceback.print_exc()
        call({'action': 'done', 'id': job['id'], 'ok': False, 'error': f'{type(e).__name__}: {e}'[:900]})
        sys.exit(1)


if __name__ == '__main__':
    main()
