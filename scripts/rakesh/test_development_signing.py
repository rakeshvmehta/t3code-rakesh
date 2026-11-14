import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('signing',Path(__file__).with_name('sign-mac-development.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SigningTests(unittest.TestCase):
    def test_regenerates_feed_after_signing_and_drops_stale_blockmap(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'app.zip').write_bytes(b'signed zip');(root/'app.dmg').write_bytes(b'signed dmg')
            feed={'version':'0.1.12','files':[{'url':'app.zip','sha512':'old','size':1,'blockMapSize':22},{'url':'app.dmg','sha512':'old','size':1}], 'path':'app.zip','sha512':'old'}
            got=m.refresh_feed(feed,root,'0.1.12')
            self.assertEqual(got['sha512'],base64.b64encode(hashlib.sha512(b'signed zip').digest()).decode())
            self.assertEqual(got['files'][0]['size'],10)
            self.assertNotIn('blockMapSize',got['files'][0])
    def test_refuses_foreign_assets_or_version(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ('../app.zip','https://elsewhere/app.zip','app.exe'):
                with self.assertRaises(ValueError):m.refresh_feed({'version':'0.1.12','files':[{'url':name}]},Path(d),'0.1.12')
            with self.assertRaises(ValueError):m.refresh_feed({'version':'0.1.11','files':[]},Path(d),'0.1.12')
if __name__=='__main__':unittest.main()
