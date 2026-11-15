import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('manifest',Path(__file__).with_name('release-manifest.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class ManifestTests(unittest.TestCase):
    def data(self):
        return {'channel':'stable','version':'0.1.10','source_sha':'a'*40}
    def test_maintainer_validation_base_is_exact_and_defaults_to_source(self):
        data=self.data()
        self.assertEqual(m.validate(data,'ops/t3r-build/stable/test')['validation_base_sha'],data['source_sha'])
        self.assertEqual(m.validate({**data,'validation_base_sha':'b'*40},'ops/t3r-build/stable/test')['validation_base_sha'],'b'*40)
        for value in ('main','b'*40+'\nother=bad'):
            with self.assertRaises(ValueError):m.validate({**data,'validation_base_sha':value},'ops/t3r-build/stable/test')
    def test_rejects_wrong_channel_branch(self):
        with self.assertRaises(ValueError): m.validate(self.data(),'ops/t3r-build/nightly/test')
    def test_rejects_untrusted_ref_and_injection(self):
        for sha in ('main','a'*40+'\nversion=9.0.0','$(id)'):
            with self.assertRaises(ValueError): m.validate({**self.data(),'source_sha':sha},'ops/t3r-build/stable/test')
    def test_separates_stable_and_nightly(self):
        for version in ('0.1.10-nightly.20261114.1','0.1.10+foo','0.1.10\nsource_sha=x'):
            with self.assertRaises(ValueError): m.validate({**self.data(),'version':version},'ops/t3r-build/stable/test')
        m.validate(self.data(),'ops/t3r-build/stable/test')
        m.validate({**self.data(),'channel':'nightly','version':'0.1.11-nightly.20261114.1'},'ops/t3r-build/nightly/test')
if __name__=='__main__': unittest.main()
