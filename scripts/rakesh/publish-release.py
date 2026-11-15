"""Create/reconcile a verified draft release. Public promotion is deliberately separate."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

REPO='rakeshvmehta/t3code-rakesh'
IDENTITY='Apple Development: rakeshvmehta@icloud.com (YJK8Y5SDNK)'
TEAM='FFDV9VFWF5'
CERTIFICATE_SHA1='346D432E7E4D31B75AFE533CB11B81584A9BBF6A'


def release_tag(request):
    version=request['version'];pattern=r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
    if request['channel']=='nightly':pattern+=r'-nightly\.[0-9]{8}\.[1-9][0-9]*'
    if request['channel'] not in ('stable','nightly') or not re.fullmatch(pattern,version):raise ValueError('Invalid release version')
    if type(request['run_id']) is not int or request['run_id']<1 or not re.fullmatch('[0-9a-f]{40}',request['candidate_sha']):raise ValueError('Invalid build identity')
    return f"v{version}"


def verify_tag_target(output,request):
    tag='refs/tags/'+release_tag(request)
    refs={parts[1]:parts[0] for line in output.splitlines() if len(parts:=line.split())==2}
    target=refs.get(tag+'^{}',refs.get(tag))
    if target is not None and target!=request['candidate_sha']:
        raise ValueError('Version tag already belongs to another source; refusing overwrite')


def release_body(request):
    tag=release_tag(request)
    return (f"T3-R {request['channel']} {request['version']}\n\n"
            "macOS desktop: signed with the approved personal Apple Development identity; NOT notarized.\n"
            "macOS standalone CLI: ad-hoc signed; NOT notarized. Windows: unsigned. Linux: checksum-verified artifacts.\n\n"
            f"Build: https://github.com/{REPO}/actions/runs/{request['run_id']}\n"
            f"<!-- t3r-controller:{tag}:{request['candidate_sha']} -->\n")


def verify_signing(root,request):
    fingerprint=None
    for arch in ('arm64','x64'):
        receipt=json.loads((root/f'mac-signing-{arch}.json').read_text())
        expected={'arch':arch,'channel':request['channel'],'version':request['version'],'candidate_sha':request['candidate_sha'],
                  'bundle_id':'com.rakesh.t3code'+('.nightly' if request['channel']=='nightly' else ''),
                  'identity':IDENTITY,'team_id':TEAM,'codesign_verified':True,'notarized':False,'signing_mode':'approved-personal-development'}
        if any(receipt.get(k)!=v for k,v in expected.items()):raise ValueError('Mac signing evidence differs from approved candidate')
        value=receipt.get('certificate_sha1','')
        if value!=CERTIFICATE_SHA1 or (fingerprint and value!=fingerprint):raise ValueError('Mac architectures have different signing identities')
        fingerprint=value
    return {'identity':IDENTITY,'team_id':TEAM,'certificate_sha1':fingerprint,'notarized':False}


def verify_existing(release,request):
    if (release.get('draft') is not True or release.get('tag_name')!=release_tag(request)
        or release.get('target_commitish')!=request['candidate_sha'] or release.get('body')!=release_body(request)):
        raise ValueError('Existing release is not this exact controller-owned draft; refusing mutation')


def gh(*args):return subprocess.check_output(['gh',*args])


def api(endpoint,payload=None):
    args=['api',f'repos/{REPO}/'+endpoint]
    if payload is None:return json.loads(gh(*args))
    return json.loads(subprocess.check_output(['gh',*args,'--input','-'],input=json.dumps(payload).encode()))


def sha256(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def cli_names(version):
    return {f't3-{version}-{platform}.{extension}' for platform,extension in (
        ('darwin-arm64','tar.gz'),('linux-x64','tar.gz'),('linux-arm64','tar.gz'),
        ('win32-x64','zip'),('win32-arm64','zip'))}


def stage_cli(source,root,request):
    expected=cli_names(request['version'])
    files=list(source.iterdir())
    if {p.name for p in files}!=expected or any(p.is_symlink() or not p.is_file() or p.stat().st_size==0 for p in files):
        raise ValueError('Standalone artifacts must match the exact five native build outputs')
    for path in files:
        target=root/path.name
        if target.exists():raise ValueError('Standalone staging destination already exists')
        shutil.copyfile(path,target)
    (root/'SHA256SUMS').write_text(''.join(
        sha256(root/name)+'  '+name+'\n'
        for name in sorted(expected)))


def release_assets(root,request):
    expected=cli_names(request['version'])
    entries={}
    for line in (root/'SHA256SUMS').read_text().splitlines():
        match=re.fullmatch(r'([0-9a-f]{64})  ([^/\\]+)',line)
        if not match or match[2] in entries:raise ValueError('Invalid or duplicate standalone checksum entry')
        entries[match[2]]=match[1]
    if set(entries)!=expected:raise ValueError('Missing or foreign standalone archive checksum')
    for name,digest in entries.items():
        path=root/name
        if path.is_symlink() or not path.is_file() or path.stat().st_size==0 or sha256(path)!=digest:
            raise ValueError('Standalone archive checksum mismatch')
    assets=[]
    for path in root.iterdir():
        if path.is_symlink() or not path.is_file():raise ValueError('Unexpected release asset type')
        if path.name.startswith('t3-') and path.name not in expected:raise ValueError('Foreign standalone archive')
        if path.name in expected or path.name=='SHA256SUMS' or path.suffix in ('.zip','.dmg','.exe','.deb','.AppImage','.yml','.blockmap','.json'):
            assets.append(path)
    return assets


def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('request',type=Path);parser.add_argument('--cli-directory',type=Path)
    args=parser.parse_args();request=json.loads(args.request.read_text());root=args.directory
    tag=release_tag(request);signing=verify_signing(root,request)
    if args.cli_directory:stage_cli(args.cli_directory,root,request)
    release_assets(root,request)
    refs=subprocess.check_output(['git','ls-remote','--tags',f'https://github.com/{REPO}.git',f'refs/tags/{tag}',f'refs/tags/{tag}^{{}}']).decode()
    verify_tag_target(refs,request)
    # Independently rerun checksum validation immediately before creating/uploading the draft.
    subprocess.run(['python3',str(Path(__file__).with_name('verify-release-assets.py')),str(root),
                    '--channel',request['channel'],'--version',request['version']],check=True)
    assets=release_assets(root,request)
    pages=json.loads(gh('api','--paginate','--slurp',f'repos/{REPO}/releases?per_page=100'))
    matches=[r for page in pages for r in page if r['tag_name']==tag]
    if len(matches)>1:raise ValueError('Duplicate releases for candidate tag')
    if matches:release=matches[0];verify_existing(release,request)
    else:
        release=api('releases',{'tag_name':tag,'target_commitish':request['candidate_sha'],
                    'name':f"T3-R {request['channel']} {request['version']}",'body':release_body(request),
                    'draft':True,'prerelease':request['channel']=='nightly','make_latest':'false'})
    rid=release['id']
    expected={p.name:{'size':p.stat().st_size,'digest':'sha256:'+sha256(p)} for p in assets}
    remote=api(f'releases/{rid}/assets?per_page=100')
    if any(a['name'] not in expected for a in remote):raise ValueError('Draft contains foreign assets')
    existing={a['name']:a for a in remote}
    if len(existing)!=len(remote):raise ValueError('Duplicate draft assets')
    for path in assets:
        if path.name in existing:
            if any(existing[path.name].get(k)!=v for k,v in expected[path.name].items()):raise ValueError('Existing draft asset differs; refusing overwrite')
        else:gh('release','upload',tag,str(path),'--repo',REPO)
    readback=api(f'releases/{rid}');verify_existing(readback,request)
    received={a['name']:{k:a.get(k) for k in ('size','digest')} for a in api(f'releases/{rid}/assets?per_page=100')}
    if received!=expected:raise ValueError('Uploaded draft asset readback mismatch')
    receipt={'release_id':rid,'tag':tag,'candidate_sha':request['candidate_sha'],'run_id':request['run_id'],
             'draft':True,'published':False,'signing':signing,'assets':expected,'cutover_status':'NOT_READY'}
    Path('draft-publication-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')


if __name__=='__main__':main()
