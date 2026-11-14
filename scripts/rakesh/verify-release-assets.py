"""Validate assembled update feeds against the exact downloaded installers."""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path
import urllib.parse
import yaml


def verify_feed(path, version):
    data=yaml.safe_load(path.read_text())
    if not isinstance(data,dict) or data.get('version')!=version or not data.get('files'):
        raise ValueError('Feed version/files do not match the candidate')
    names=[]
    for entry in data['files']:
        name=urllib.parse.unquote(entry['url'])
        if not name or Path(name).name!=name or '/' in name or '\\' in name or ':' in name:
            raise ValueError('Feed must reference a local release asset')
        asset=path.parent/name
        if asset.is_symlink():
            raise ValueError('Release assets must not be symlinks')
        with asset.open('rb') as f:digest=base64.b64encode(hashlib.file_digest(f,'sha512').digest()).decode()
        if digest!=entry['sha512'] or asset.stat().st_size!=entry['size']:
            raise ValueError('Release asset checksum or size mismatch')
        names.append(name)
    if 'path' in data or 'sha512' in data:
        legacy_path=data.get('path')
        if not isinstance(legacy_path,str):
            raise ValueError('Legacy feed path is invalid')
        matches=[entry for entry in data['files'] if urllib.parse.unquote(entry['url'])==urllib.parse.unquote(legacy_path)]
        if len(matches)!=1 or data.get('sha512')!=matches[0]['sha512']:
            raise ValueError('Legacy feed fields disagree with verified files')
    return names


def verify_release(root, channel, version):
    pattern=r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
    if channel=='nightly':pattern+=r'-nightly\.[0-9]{8}\.[1-9][0-9]*'
    if channel not in ('stable','nightly') or not isinstance(version,str) or not re.fullmatch(pattern,version):
        raise ValueError('Version/channel mismatch')
    prefix='latest' if channel=='stable' else 'nightly'
    feeds=[f'{prefix}.yml',f'{prefix}-mac.yml',f'{prefix}-linux.yml',f'{prefix}-linux-arm64.yml']
    found={p.name for p in root.glob('*.yml') if p.name!='builder-debug.yml'}
    if found!=set(feeds):
        raise ValueError('Missing, extra, or unmerged platform/channel feeds')
    files={name:verify_feed(root/name,version) for name in feeds}
    for feed,extension in ((f'{prefix}.yml','.exe'),(f'{prefix}-mac.yml','.zip')):
        for arch in ('x64','arm64'):
            if not any(name.endswith(f'-{arch}{extension}') for name in files[feed]):
                raise ValueError('Both native architectures must be present')
    for feed,arch in ((f'{prefix}-linux.yml','x86_64'),(f'{prefix}-linux-arm64.yml','arm64')):
        if not any(name.endswith(f'-{arch}.AppImage') for name in files[feed]):
            raise ValueError('Linux architecture mismatch')
    return {'channel':channel,'version':version,'verified_feeds':files,
            'published':False,'signing_verified':False,'update_cycle_verified':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path)
    parser.add_argument('--channel',required=True,choices=['stable','nightly']);parser.add_argument('--version',required=True)
    args=parser.parse_args();receipt=verify_release(args.directory,args.channel,args.version)
    (args.directory/'asset-verification.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
