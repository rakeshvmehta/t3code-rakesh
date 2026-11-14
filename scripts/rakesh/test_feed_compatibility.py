import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('signing',Path(__file__).with_name('sign-mac-development.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FeedCompatibilityTests(unittest.TestCase):
    def test_signed_feed_is_accepted_by_existing_manifest_merger(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for arch in ('arm64','x64'):
                data={'version':'0.1.12','files':[{'url':f'T3-Code-0.1.12-{arch}.zip','sha512':'YQ==','size':1}],'releaseDate':'2026-11-14T19:00:00.000Z'}
                (root/f'{arch}.yml').write_text(m.dump_feed(data))
            subprocess.run(['node','scripts/merge-update-manifests.ts','--platform','mac',str(root/'arm64.yml'),str(root/'x64.yml')],check=True,capture_output=True)
            merged=(root/'arm64.yml').read_text()
            self.assertIn('-arm64.zip',merged);self.assertIn('-x64.zip',merged)
if __name__=='__main__':unittest.main()
