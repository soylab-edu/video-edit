"""Download official Zenodo checkpoint with published integrity metadata.
Use --list to see available checkpoints, then --file EXACT_KEY --config EXPT_NAME.
Never changes application code or suppresses certificate/checksum verification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--list', action='store_true')
parser.add_argument('--file')
parser.add_argument('--config', default='dnr-3s-mus64-l1snr')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
with urllib.request.urlopen('https://zenodo.org/api/records/10160698', timeout=30) as response:
    record = json.load(response)
files = record['files']
if args.list or not args.file:
    for item in files:
        print(item['key'], item['size'], item['checksum'])
    raise SystemExit(0)
item = next(x for x in files if x['key'] == args.file)
if not item['key'].endswith('.ckpt'):
    raise SystemExit('Select a .ckpt file from the official record; archives must be inspected separately.')
config = root / '.data/vendor/bandit/expt' / (args.config + '.yaml')
if not config.is_file() or '/' in args.config or '..' in args.config:
    raise SystemExit('Select the official experiment config matching the checkpoint.')
model = root / '.data/models/bandit'
(model / 'checkpoints').mkdir(parents=True, exist_ok=True)
algorithm, expected = item['checksum'].split(':', 1)
if algorithm not in ('md5', 'sha256'):
    raise SystemExit('Unsupported official checksum algorithm')
digest = hashlib.new(algorithm)
temp = model / 'checkpoints/download.tmp'
try:
    with urllib.request.urlopen(item['links']['self'], timeout=60) as response, temp.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != expected:
        raise RuntimeError('Official checkpoint checksum mismatch')
    import yaml
    data = yaml.safe_load(config.read_text())
    data['system']['inference'] = {'fader': {'name': 'OverlapAddFader', 'kwargs': {'window_type': 'hann', 'chunk_size_second': 6.0, 'hop_size_second': 3.0, 'fs': 44100, 'batch_size': 1}}}
    (model / 'hparams.yaml').write_text(yaml.safe_dump(data))
    temp.replace(model / 'checkpoints/model.ckpt')
    (model / 'checkpoint.json').write_text(json.dumps({'record': 'https://zenodo.org/records/10160698', 'key': item['key'], 'checksum': item['checksum'], 'config': args.config}))
    print('Verified checkpoint installed. Run scripts/bandit-runner.py --check.')
finally:
    temp.unlink(missing_ok=True)
