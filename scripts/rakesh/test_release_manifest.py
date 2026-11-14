import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('manifest',Path(__file__).with_name('release-manifest.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class ManifestTests(unittest.TestCase):
    def data(self):
        return {'channel':'stable','version':'0.1.10','source_sha':'a'*40}
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
