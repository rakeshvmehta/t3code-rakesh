import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
spec=importlib.util.spec_from_file_location('publication',Path(__file__).with_name('publish-release.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PublicationTests(unittest.TestCase):
    def request(self):return {'channel':'stable','version':'0.1.12','candidate_sha':'a'*40,'run_id':123}
    def evidence(self,arch):return {'arch':arch,'channel':'stable','version':'0.1.12','candidate_sha':'a'*40,'bundle_id':'com.rakesh.t3code','identity':m.IDENTITY,'team_id':m.TEAM,'certificate_sha1':'B'*40,'codesign_verified':True,'notarized':False,'signing_mode':'approved-personal-development'}
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
        for bad in ({'draft':False},{'body':'someone else release'},{'target_commitish':'main'},{'tag_name':'v0.1.12'}):
            with self.assertRaises(ValueError):m.verify_existing({**release,**bad},request)
if __name__=='__main__':unittest.main()
