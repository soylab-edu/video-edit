"""Run the pinned official BandIt DnR inference with a verified local checkpoint."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / '.data/vendor/bandit'
MODEL = ROOT / '.data/models/bandit'

def checkpoint():
    manifest = json.loads((MODEL / 'checkpoint.json').read_text())
    file = MODEL / 'checkpoints/model.ckpt'
    algorithm, expected = manifest['checksum'].split(':', 1)
    if algorithm not in ('md5', 'sha256'):
        raise ValueError('Unsupported checkpoint checksum')
    digest = hashlib.new(algorithm)
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError('Checkpoint integrity verification failed')
    return file

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input')
    parser.add_argument('--output')
    args = parser.parse_args()
    sys.path.insert(0, str(VENDOR))
    os.environ['PROJECT_ROOT'] = str(VENDOR)
    os.environ['DATA_ROOT'] = str(ROOT / '.data')
    os.environ['NUMBA_CACHE_DIR'] = str(ROOT / '.data/numba')
    import torch
    torch.set_num_threads(2)
    from inference import inference
    file = checkpoint()
    if args.check:
        print(json.dumps({'ready': True, 'stems': ['speech', 'music', 'effects']}))
        return
    if not args.input or not args.output:
        parser.error('--input and --output are required')
    import soundfile as sf
    import numpy as np
    import tempfile
    audio, sample_rate = sf.read(args.input, always_2d=True)
    original_frames = len(audio)
    original_channels = audio.shape[1]
    identical_stereo = original_channels == 2 and np.array_equal(audio[:, 0], audio[:, 1])
    if identical_stereo:
        audio = audio[:, :1]
    # The official overlap/add fader uses reflection padding longer than short
    # clips. Pad only the temporary input, then trim all outputs back exactly.
    with tempfile.TemporaryDirectory(prefix='moa-bandit-') as temp:
        padded = Path(temp) / 'input.wav'
        import yaml
        fader = yaml.safe_load((MODEL / 'hparams.yaml').read_text())['system']['inference']['fader']['kwargs']
        minimum = round(2 * (fader['chunk_size_second'] - fader['hop_size_second']) * sample_rate) + 1
        if original_frames < minimum:
            audio = np.pad(audio, ((0, minimum - original_frames), (0, 0)))
        sf.write(padded, audio, sample_rate, subtype='FLOAT')
        inference(ckpt_path=str(file), file_path=str(padded), model_name='bandit-dnr', output_dir=args.output, include_track_name=False, get_residual=False, get_no_vox_combinations=False)
    for stem in ['speech', 'music', 'effects']:
        output = Path(args.output) / (stem + '.wav')
        if not output.is_file():
            raise RuntimeError(f'Missing expected {stem} output')
        separated, rate = sf.read(output, always_2d=True)
        expected = round(original_frames * rate / sample_rate)
        if len(separated) < expected or not np.isfinite(separated).all():
            raise RuntimeError('Invalid or truncated separation output')
        if identical_stereo:
            separated = np.repeat(separated, original_channels, axis=1)
        sf.write(output, separated[:expected], rate, subtype='PCM_24')

if __name__ == '__main__':
    main()
