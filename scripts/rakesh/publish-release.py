"""Create/reconcile a verified draft release. Public promotion is deliberately separate."""
import argparse
import hashlib
import json
from pathlib import Path
import re
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
    return f"v{version}+t3r.{request['run_id']}"


def release_body(request):
    tag=release_tag(request)
    return (f"T3-R {request['channel']} {request['version']}\n\n"
            "macOS: signed with the approved personal Apple Development identity; NOT notarized.\n"
            "Windows: unsigned. Linux: checksum-verified artifacts.\n\n"
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


def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('request',type=Path)
    args=parser.parse_args();request=json.loads(args.request.read_text());root=args.directory
    tag=release_tag(request);signing=verify_signing(root,request)
    # Independently rerun checksum validation immediately before creating/uploading the draft.
    subprocess.run(['python3',str(Path(__file__).with_name('verify-release-assets.py')),str(root),
                    '--channel',request['channel'],'--version',request['version']],check=True)
    pages=json.loads(gh('api','--paginate','--slurp',f'repos/{REPO}/releases?per_page=100'))
    matches=[r for page in pages for r in page if r['tag_name']==tag]
    if len(matches)>1:raise ValueError('Duplicate releases for candidate tag')
    if matches:release=matches[0];verify_existing(release,request)
    else:
        release=api('releases',{'tag_name':tag,'target_commitish':request['candidate_sha'],
                    'name':f"T3-R {request['channel']} {request['version']}",'body':release_body(request),
                    'draft':True,'prerelease':request['channel']=='nightly','make_latest':'false'})
    rid=release['id'];assets=[p for p in root.iterdir() if p.is_file() and not p.is_symlink() and p.suffix in ('.zip','.dmg','.exe','.deb','.AppImage','.yml','.blockmap','.json')]
    expected={p.name:{'size':p.stat().st_size,'digest':'sha256:'+hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p in assets}
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
