"""Validate the PC-created candidate before any build worker uses its values."""
import json
import os
from pathlib import Path
import re
import subprocess


def validate(data, branch):
    channel = data.get('channel')
    if channel not in ('stable', 'nightly') or not branch.startswith(f'ops/t3r-build/{channel}/'):
        raise ValueError('Candidate branch must match its channel')
    if not re.fullmatch(r'[0-9a-f]{40}', data.get('source_sha', '')):
        raise ValueError('Source must be an exact commit')
    version_pattern = r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
    if channel == 'nightly':
        version_pattern += r'-nightly\.[0-9]{8}\.[1-9][0-9]*'
    if not re.fullmatch(version_pattern, data.get('version', '')):
        raise ValueError('Version does not match channel')
    return {k: data[k] for k in ('channel', 'version', 'source_sha')}


def main():
    data = validate(json.loads(Path('scripts/rakesh/release-candidate.json').read_text()), os.environ['GITHUB_REF_NAME'])
    subprocess.run(['git', 'merge-base', '--is-ancestor', data['source_sha'], 'HEAD'], check=True)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        for key, value in data.items():
            stream.write(f'{key}={value}\n')


if __name__ == '__main__':
    main()
