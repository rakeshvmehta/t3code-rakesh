from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest


class UpdateAgentMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scripts = self.root / 'scripts/rakesh'
        self.scripts.mkdir(parents=True)
        self.agents = self.root / 'LaunchAgents'
        self.agents.mkdir()
        self.calls = self.root / 'calls'
        source = Path(__file__).parent
        installer = (source / 'install-launch-agent.sh').read_text()
        if '$HOME/Library/LaunchAgents' not in installer:
            raise AssertionError('Installer fixture must redirect the LaunchAgents path')
        (self.scripts / 'install-launch-agent.sh').write_text(
            installer.replace('$HOME/Library/LaunchAgents', str(self.agents)))
        for template in source.glob('com.rakesh.t3code.*.plist'):
            (self.scripts / template.name).write_bytes(template.read_bytes())
        self.legacy = self.agents / 'com.rakesh.t3code.nightly.plist'
        self.legacy.write_bytes(plistlib.dumps({'Label': 'com.rakesh.t3code.nightly'}))
        (self.scripts / 'env.sh').write_text(f'''
RAKESH_REPO_ROOT='{self.root}'
RAKESH_LOG_DIR='{self.root / 'logs'}'
git() {{ return 0; }}
launchctl() {{
  printf '%s\\n' "$*" >>'{self.calls}'
  if [[ "$1" == print ]]; then
    [[ -f '{self.root / 'running'}' ]] && printf 'pid = 123\\n'
    return 0
  fi
  if [[ "$1" == bootstrap && "$*" == *stable-update.plist && -f '{self.root / 'fail'}' ]]; then
    return 1
  fi
  return 0
}}
''')

    def install(self):
        return subprocess.run(['bash', str(self.scripts / 'install-launch-agent.sh')],
                              capture_output=True, text=True, timeout=10)

    def test_legacy_job_migrates_to_stable_name_and_keeps_schedule(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        new = self.agents / 'com.rakesh.t3code.stable-update.plist'
        self.assertTrue(new.exists())
        data = plistlib.loads(new.read_bytes())
        self.assertEqual(data['Label'], 'com.rakesh.t3code.stable-update')
        self.assertTrue(data['ProgramArguments'][-1].endswith('/stable-update.sh'))
        self.assertEqual(data['StartCalendarInterval'], [
            {'Hour': 4, 'Minute': 0}, {'Hour': 4, 'Minute': 30},
            {'Hour': 5, 'Minute': 0}, {'Hour': 5, 'Minute': 30}])
        self.assertFalse(self.legacy.exists())

    def test_failed_registration_restores_legacy_job(self):
        (self.root / 'fail').touch()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.legacy.exists())
        self.assertTrue(self.calls.read_text().splitlines()[-1].endswith(self.legacy.name))

    def test_running_update_is_not_interrupted_for_rename(self):
        (self.root / 'running').touch()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.legacy.exists())
        self.assertFalse(any(x.startswith(('bootout', 'bootstrap'))
                             for x in self.calls.read_text().splitlines()))


if __name__ == '__main__':
    unittest.main()
