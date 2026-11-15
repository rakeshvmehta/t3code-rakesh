import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish-release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PublicationTests(unittest.TestCase):
    def request(self):return {'channel':'stable','version':'0.1.12','candidate_sha':'a'*40,'run_id':123}
    def evidence(self,arch):return {'arch':arch,'channel':'stable','version':'0.1.12','candidate_sha':'a'*40,'bundle_id':'com.rakesh.t3code','identity':m.IDENTITY,'team_id':m.TEAM,'certificate_sha1':m.CERTIFICATE_SHA1,'codesign_verified':True,'notarized':False,'signing_mode':'approved-personal-development'}
    def test_missing_mismatched_or_unsigned_mac_evidence_blocks_draft(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with self.assertRaises((ValueError,FileNotFoundError)):m.verify_signing(root,self.request())
            for arch in ('arm64','x64'):(root/f'mac-signing-{arch}.json').write_text(json.dumps(self.evidence(arch)))
            self.assertEqual(m.verify_signing(root,self.request())['team_id'],m.TEAM)
            for key,bad in [('candidate_sha','c'*40),('certificate_sha1','C'*40),('codesign_verified',False),('bundle_id','com.t3tools.t3code')]:
                (root/'mac-signing-x64.json').write_text(json.dumps({**self.evidence('x64'),key:bad}))
                with self.assertRaises(ValueError):m.verify_signing(root,self.request())
    def test_existing_release_must_be_exact_draft_with_owned_marker(self):
        request=self.request();body=m.release_body(request)
        release={'draft':True,'tag_name':m.release_tag(request),'target_commitish':request['candidate_sha'],'body':body}
        m.verify_existing(release,request)
        for bad in ({'draft':False},{'body':'someone else release'},{'target_commitish':'main'},{'tag_name':'v0.1.13'}):
            with self.assertRaises(ValueError):m.verify_existing({**release,**bad},request)
    def test_standalone_archives_and_checksums_are_published_and_tampering_rejected(self):
        import hashlib
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);version='0.1.12'
            names=[f't3-{version}-{platform}.{extension}' for platform,extension in [('darwin-arm64','tar.gz'),('linux-x64','tar.gz'),('linux-arm64','tar.gz'),('win32-x64','zip'),('win32-arm64','zip')]]
            for name in names:(root/name).write_bytes(b'verified native artifact')
            (root/'SHA256SUMS').write_text(''.join(hashlib.sha256((root/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in names))
            selected={p.name for p in m.release_assets(root,self.request())}
            self.assertEqual(selected,set(names)|{'SHA256SUMS'})
            (root/names[0]).write_bytes(b'changed')
            with self.assertRaises(ValueError):m.release_assets(root,self.request())
            (root/'SHA256SUMS').unlink()
            with self.assertRaises((ValueError,FileNotFoundError)):m.release_assets(root,self.request())

    def test_staging_rejects_missing_or_foreign_outputs_and_preserves_checksums(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'input';out=root/'output';source.mkdir();out.mkdir()
            with self.assertRaises(ValueError):m.stage_cli(source,out,self.request())
            names=['t3-0.1.12-darwin-arm64.tar.gz','t3-0.1.12-linux-x64.tar.gz','t3-0.1.12-linux-arm64.tar.gz','t3-0.1.12-win32-x64.zip','t3-0.1.12-win32-arm64.zip']
            for name in names:(source/name).write_bytes(name.encode())
            (source/'foreign').write_bytes(b'x')
            with self.assertRaises(ValueError):m.stage_cli(source,out,self.request())
            self.assertEqual(list(out.iterdir()),[])
            (source/'foreign').unlink();m.stage_cli(source,out,self.request())
            self.assertEqual({p.name for p in m.release_assets(out,self.request())},set(names)|{'SHA256SUMS'})
            for name in names:self.assertEqual((source/name).read_bytes(),(out/name).read_bytes())

    def test_plain_tags_and_existing_tag_collisions(self):
        request=self.request();self.assertEqual(m.release_tag(request),'v0.1.12')
        m.verify_tag_target('',request)
        m.verify_tag_target('a'*40+'\trefs/tags/v0.1.12\n',request)
        m.verify_tag_target('b'*40+'\trefs/tags/v0.1.12\n'+'a'*40+'\trefs/tags/v0.1.12^{}\n',request)
        with self.assertRaises(ValueError):m.verify_tag_target('b'*40+'\trefs/tags/v0.1.12\n',request)
if __name__=='__main__':unittest.main()
