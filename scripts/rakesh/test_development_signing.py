import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('signing',Path(__file__).with_name('sign-mac-development.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SigningTests(unittest.TestCase):
    def test_codesign_errors_are_diagnostic_but_keychain_commands_stay_redacted(self):
        from unittest.mock import patch
        import subprocess
        error=subprocess.CompletedProcess([],1,stdout=b'',stderr=b'errSecInternalComponent')
        with patch.object(m.subprocess,'run',return_value=error):
            with self.assertRaisesRegex(RuntimeError,'errSecInternalComponent'):m.run('codesign','--sign','public-fingerprint','app')
            with self.assertRaises(RuntimeError) as raised:m.run('security','import','file','-P','secret')
            self.assertNotIn('errSecInternalComponent',str(raised.exception))
            self.assertNotIn('secret',str(raised.exception))
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

class DmgRetryTests(unittest.TestCase):
    def test_resource_busy_retries_and_verifies_before_return(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'signed.dmg';calls=[]
            def run(*args):
                calls.append(args)
                if args[1]=='create':
                    if len([x for x in calls if x[1]=='create'])==1:raise RuntimeError('hdiutil failed with exit 1: Resource busy')
                    Path(args[-1]).write_bytes(b'dmg')
                return ''
            with patch.object(m,'run',side_effect=run),patch('time.sleep'):
                m.create_dmg(Path(d)/'payload',target,'1.2.3')
            self.assertEqual(target.read_bytes(),b'dmg')
            self.assertEqual([x[1] for x in calls],['create','create','verify'])
    def test_other_failures_not_retried_and_busy_retry_is_bounded(self):
        from unittest.mock import patch
        for message,count in [('permission denied',1),('Resource busy',3)]:
            with tempfile.TemporaryDirectory() as d,patch.object(m,'run',side_effect=RuntimeError(message)) as run,patch('time.sleep'):
                with self.assertRaises(RuntimeError):m.create_dmg(Path(d)/'payload',Path(d)/'signed.dmg','1.2.3')
                self.assertEqual(run.call_count,count)

if __name__=='__main__':unittest.main()
