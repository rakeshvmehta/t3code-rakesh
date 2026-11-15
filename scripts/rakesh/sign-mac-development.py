"""Repackage Mac artifacts with the explicitly approved development identity, never notarize."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import subprocess
import tempfile
import urllib.parse

IDENTITY='Apple Development: rakeshvmehta@icloud.com (YJK8Y5SDNK)'
TEAM='FFDV9VFWF5'
CERTIFICATE_SHA1='346D432E7E4D31B75AFE533CB11B81584A9BBF6A'


def refresh_feed(data,root,version):
    if data.get('version')!=version or not data.get('files'):
        raise ValueError('Unexpected feed version or files')
    result={**data,'files':[]}
    for entry in data['files']:
        name=urllib.parse.unquote(entry['url'])
        if Path(name).name!=name or '/' in name or '\\' in name or ':' in name or not name.endswith(('.zip','.dmg')):
            raise ValueError('Unexpected Mac asset')
        path=root/name
        if path.is_symlink():raise ValueError('Asset must not be a symlink')
        with path.open('rb') as stream:digest=base64.b64encode(hashlib.file_digest(stream,'sha512').digest()).decode()
        new={k:v for k,v in entry.items() if k not in ('sha512','size','blockMapSize')}
        result['files'].append({**new,'sha512':digest,'size':path.stat().st_size})
    if 'path' in result:
        matches=[f for f in result['files'] if f['url']==result['path']]
        if len(matches)!=1:raise ValueError('Legacy feed path does not match assets')
        result['sha512']=matches[0]['sha512']
    return result


def dump_feed(data):
    import yaml
    class FeedDumper(yaml.SafeDumper):
        def increase_indent(self,flow=False,indentless=False):
            return super().increase_indent(flow,False)
    return yaml.dump(data,Dumper=FeedDumper,sort_keys=False)


def run(*args):
    # Never include command arguments in exceptions: security commands contain passwords.
    process=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if process.returncode:
        detail=process.stderr.decode(errors='replace')[-4000:] if args[0] in ('codesign','hdiutil') else ''
        raise RuntimeError(f'{Path(args[0]).name} failed with exit {process.returncode}: {detail}')
    return process.stdout.decode()


def create_dmg(payload,target,version):
    import time
    for attempt in range(3):
        candidate=target.with_name(f'{target.stem}-attempt-{attempt+1}.dmg')
        try:
            run('hdiutil','create','-volname',f'T3-R {version}','-srcfolder',str(payload),'-format','UDZO',str(candidate))
        except RuntimeError as error:
            if 'resource busy' not in str(error).lower() or attempt==2:raise
            if candidate.is_file():candidate.unlink()
            time.sleep(2**(attempt+1))
            continue
        run('hdiutil','verify',str(candidate))
        candidate.replace(target)
        return


def main():
    import yaml
    parser=argparse.ArgumentParser();parser.add_argument('--version',required=True)
    parser.add_argument('--channel',choices=['stable','nightly'],required=True)
    parser.add_argument('--arch',choices=['arm64','x64'],required=True)
    args=parser.parse_args()
    if os.uname().sysname!='Darwin':raise RuntimeError('Native Mac worker required')
    root=Path('release').resolve();zips=list(root.glob('*.zip'));dmgs=list(root.glob('*.dmg'))
    if len(zips)!=1 or len(dmgs)!=1:raise ValueError('Expected exactly one Mac zip and dmg')
    prefix='latest' if args.channel=='stable' else 'nightly'
    feed=root/f'{prefix}-mac.yml';original=yaml.safe_load(feed.read_text())
    if original['version']!=args.version:raise ValueError('Unexpected build version')
    with tempfile.TemporaryDirectory(prefix='t3r-development-sign-',dir=os.environ['RUNNER_TEMP']) as tmp:
        temp=Path(tmp);keychain=temp/'signing.keychain-db';p12=temp/'identity.p12'
        p12.write_bytes(base64.b64decode(os.environ.pop('T3R_MAC_DEVELOPMENT_P12'),validate=True));p12.chmod(0o600)
        keypass=secrets.token_urlsafe(36)
        previous_keychains=shlex.split(run("security","list-keychains","-d","user"))
        try:
            run('security','create-keychain','-p',keypass,str(keychain))
            run('security','set-keychain-settings','-lut','21600',str(keychain))
            run('security','unlock-keychain','-p',keypass,str(keychain))
            run('security','list-keychains','-d','user','-s',str(keychain),*previous_keychains)
            run('security','import',str(p12),'-k',str(keychain),'-P',os.environ.pop('T3R_MAC_DEVELOPMENT_PASSWORD'),'-T','/usr/bin/codesign')
            run('security','set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',keypass,str(keychain))
            identities=run('security','find-identity','-v','-p','codesigning',str(keychain))
            matches=re.findall(r'([0-9A-F]{40}) "'+re.escape(IDENTITY)+'"',identities)
            if matches!=[CERTIFICATE_SHA1]:raise ValueError('Approved development certificate fingerprint missing or ambiguous')
            p12.unlink()
            payload=temp/'payload';payload.mkdir()
            run('ditto','-x','-k',str(zips[0]),str(payload))
            apps=list(payload.glob('*.app'))
            if len(apps)!=1:raise ValueError('Expected one app bundle')
            app=apps[0];info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
            bundle='com.rakesh.t3code'+('.nightly' if args.channel=='nightly' else '')
            if info['CFBundleIdentifier']!=bundle or info['CFBundleShortVersionString']!=args.version:
                raise ValueError('App identity/version mismatch')
            update=yaml.safe_load((app/'Contents/Resources/app-update.yml').read_text())
            expected_feed={'provider':'github','owner':'rakeshvmehta','repo':'t3code-rakesh','releaseType':'prerelease' if args.channel=='nightly' else 'release'}
            if any(update.get(k)!=v for k,v in expected_feed.items()) or update.get('channel','latest')!=prefix:
                raise ValueError('Packaged app points at the wrong update feed')
            run('codesign','--force','--deep','--keychain',str(keychain),'--sign',matches[0],str(app))
            run('codesign','--verify','--deep','--strict',str(app))
            details=subprocess.run(['codesign','-d','--verbose=4',str(app)],capture_output=True,check=True).stderr.decode()
            if f'Authority={IDENTITY}' not in details or f'TeamIdentifier={TEAM}' not in details:
                raise ValueError('Unexpected code signing authority/team')
            newzip=temp/'signed.zip';run('ditto','-c','-k','--sequesterRsrc','--keepParent',str(app),str(newzip))
            (payload/'Applications').symlink_to('/Applications')
            newdmg=temp/'signed.dmg'
            create_dmg(payload,newdmg,args.version)
            newzip.replace(zips[0]);newdmg.replace(dmgs[0])
            feed.write_text(dump_feed(refresh_feed(original,root,args.version)))
            for stale in root.glob('*.blockmap'):stale.unlink()
            receipt={'channel':args.channel,'version':args.version,'arch':args.arch,'candidate_sha':os.environ['GITHUB_SHA'],
                     'bundle_id':bundle,'identity':IDENTITY,'team_id':TEAM,'certificate_sha1':matches[0],
                     'codesign_verified':True,'notarized':False,'signing_mode':'approved-personal-development'}
            (root/f'mac-signing-{args.arch}.json').write_text(json.dumps(receipt,indent=2)+'\n')
        finally:
            try:run('security','list-keychains','-d','user','-s',*previous_keychains)
            finally:
                if keychain.exists():run('security','delete-keychain',str(keychain))


if __name__=='__main__':main()
