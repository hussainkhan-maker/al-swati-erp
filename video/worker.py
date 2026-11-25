#!/usr/bin/env python3
# Runs in the GitHub workflow "Video": takes the next plan from the "video" function, renders it and uploads the MP4.
# GitHub signs a token for this run (OIDC); the function accepts only runs of video.yml on main of this repository.
import json, os, re, sys, traceback, urllib.request

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


def main():
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
