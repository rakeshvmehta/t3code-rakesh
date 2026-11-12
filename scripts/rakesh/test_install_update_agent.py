from pathlib import Path
import plistlib
import shutil
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
  if [[ "$1" == bootstrap && -f '{self.root / 'fail'}' ]]; then
    rm '{self.root / 'fail'}'
    return 1
  fi
  if [[ "$1" == bootout && -f '{self.root / 'fail-bootout'}' ]]; then
    rm '{self.root / 'fail-bootout'}'
    return 1
  fi
  return 0
}}
''')

    def install(self, *arguments):
        return subprocess.run(['bash', str(self.scripts / 'install-launch-agent.sh'), *arguments],
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

    def test_nightly_job_coexists_with_stable_and_does_not_remove_legacy_stable_job(self):
        stable = self.agents / 'com.rakesh.t3code.stable-update.plist'
        original = plistlib.dumps({'Label': 'com.rakesh.t3code.stable-update', 'existing': True})
        stable.write_bytes(original)
        result = self.install('nightly')
        self.assertEqual(result.returncode, 0, result.stderr)
        nightly = self.agents / 'com.rakesh.t3code.t3rn-update.plist'
        self.assertTrue(nightly.exists(), 'Nightly job was not configured')
        data = plistlib.loads(nightly.read_bytes())
        self.assertEqual(data['Label'], 'com.rakesh.t3code.t3rn-update')
        self.assertTrue(data['ProgramArguments'][-1].endswith('/t3rn-update.sh'))
        self.assertEqual(data['StartCalendarInterval'], [
            {'Hour': 2, 'Minute': 0}, {'Hour': 2, 'Minute': 30},
            {'Hour': 3, 'Minute': 0}, {'Hour': 3, 'Minute': 30}])
        self.assertEqual(stable.read_bytes(), original)
        self.assertTrue(self.legacy.exists())

    def test_explicit_follower_mode_overrides_an_upstream_remote_for_vm_handoff(self):
        result = self.install('nightly', 'follow')
        self.assertEqual(result.returncode, 0, result.stderr)
        nightly = self.agents / 'com.rakesh.t3code.t3rn-update.plist'
        self.assertTrue(nightly.exists(), 'Nightly follower job was not configured')
        data = plistlib.loads(nightly.read_bytes())
        self.assertEqual(data['EnvironmentVariables']['RAKESH_UPDATE_MODE'], 'follow')
        self.assertEqual(data['StartCalendarInterval'][0], {'Hour': 3, 'Minute': 0})
        self.assertTrue(self.legacy.exists())

    def test_failed_nightly_registration_restores_its_previous_job(self):
        nightly = self.agents / 'com.rakesh.t3code.t3rn-update.plist'
        original = plistlib.dumps({'Label': 'com.rakesh.t3code.t3rn-update', 'existing': True})
        nightly.write_bytes(original)
        (self.root / 'fail').touch()
        result = self.install('nightly')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(nightly.read_bytes(), original)
        self.assertTrue(self.legacy.exists())
        self.assertTrue(self.calls.read_text().splitlines()[-1].endswith(nightly.name))

    def test_invalid_role_does_not_change_any_jobs(self):
        result = self.install('nightly', 'typo')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.legacy.exists())
        self.assertFalse(self.calls.exists())

    def existing_channels(self):
        originals = {}
        for label in ('com.rakesh.t3code.stable-update', 'com.rakesh.t3code.t3rn-update'):
            path = self.agents / (label + '.plist')
            originals[label] = plistlib.dumps({'Label': label, 'existing': True})
            path.write_bytes(originals[label])
        return originals

    def test_combined_job_replaces_both_old_jobs_and_runs_in_the_morning(self):
        self.existing_channels()
        result = self.install('both', 'maintain')
        self.assertEqual(result.returncode, 0, result.stderr)
        paths = list(self.agents.glob('*.plist'))
        self.assertEqual([path.name for path in paths], ['com.rakesh.t3code.release-update.plist'])
        data = plistlib.loads(paths[0].read_bytes())
        self.assertTrue(data['ProgramArguments'][-1].endswith('/update-all.sh'))
        self.assertEqual(data['EnvironmentVariables']['RAKESH_UPDATE_MODE'], 'maintain')
        self.assertEqual(data['StartCalendarInterval'], [
            {'Hour': 4, 'Minute': 0}, {'Hour': 4, 'Minute': 30},
            {'Hour': 5, 'Minute': 0}, {'Hour': 5, 'Minute': 30}])

    def test_combined_follower_retains_the_role_and_one_hour_publication_offset(self):
        result = self.install('both', 'follow')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = plistlib.loads((self.agents / 'com.rakesh.t3code.release-update.plist').read_bytes())
        self.assertEqual(data['EnvironmentVariables']['RAKESH_UPDATE_MODE'], 'follow')
        self.assertEqual(data['StartCalendarInterval'], [
            {'Hour': 5, 'Minute': 0}, {'Hour': 5, 'Minute': 30},
            {'Hour': 6, 'Minute': 0}, {'Hour': 6, 'Minute': 30}])

    def test_failed_combined_registration_restores_both_previous_jobs(self):
        originals = self.existing_channels()
        (self.root / 'fail').touch()
        result = self.install('both', 'maintain')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('registration failed', result.stderr)
        self.assertFalse((self.agents / 'com.rakesh.t3code.release-update.plist').exists())
        for label, original in originals.items():
            self.assertEqual((self.agents / (label + '.plist')).read_bytes(), original)
            self.assertTrue(any(line.startswith('bootstrap ') and line.endswith(label + '.plist')
                                for line in self.calls.read_text().splitlines()))

    def test_running_update_prevents_combined_migration(self):
        originals = self.existing_channels()
        (self.root / 'running').touch()
        result = self.install('both')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('updater is running', result.stderr)
        for label, original in originals.items():
            self.assertEqual((self.agents / (label + '.plist')).read_bytes(), original)
        self.assertFalse(any(line.startswith(('bootout ', 'bootstrap '))
                             for line in self.calls.read_text().splitlines()))

    def test_failed_job_removal_does_not_install_a_second_scheduler(self):
        originals = self.existing_channels()
        (self.root / 'fail-bootout').touch()
        result = self.install('both')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('could not unload', result.stderr)
        self.assertFalse((self.agents / 'com.rakesh.t3code.release-update.plist').exists())
        for label, original in originals.items():
            self.assertEqual((self.agents / (label + '.plist')).read_bytes(), original)

    def test_individual_install_cannot_duplicate_an_existing_combined_job(self):
        combined = self.agents / 'com.rakesh.t3code.release-update.plist'
        combined.write_bytes(plistlib.dumps({'Label': 'com.rakesh.t3code.release-update'}))
        result = self.install('nightly')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('both', result.stderr)
        self.assertFalse(self.calls.exists())

    def test_default_reinstall_preserves_a_combined_follower_job(self):
        result = self.install('both', 'follow')
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = plistlib.loads((self.agents / 'com.rakesh.t3code.release-update.plist').read_bytes())
        self.assertTrue(data['ProgramArguments'][-1].endswith('/update-all.sh'))
        self.assertEqual(data['EnvironmentVariables']['RAKESH_UPDATE_MODE'], 'follow')
        self.assertEqual(data['StartCalendarInterval'][0], {'Hour': 5, 'Minute': 0})


class UpdateWindowTest(unittest.TestCase):
    def test_channels_run_sequentially_even_if_stable_fails(self):
        for stable_status, nightly_status, expected_status in ((0, 0, 0), (1, 0, 1), (0, 1, 1)):
            with self.subTest(stable_status=stable_status, nightly_status=nightly_status), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                source = Path(__file__).with_name('update-all.sh')
                self.assertTrue(source.exists(), 'Combined update runner is missing')
                shutil.copyfile(source, root / 'update-all.sh')
                (root / 'env.sh').write_text('')
                events = root / 'events'
                (root / 'stable-update.sh').write_text(
                    f'echo stable-start >> "{events}"\necho stable-end >> "{events}"\nexit {stable_status}\n')
                (root / 't3rn-update.sh').write_text(f'echo nightly >> "{events}"\nexit {nightly_status}\n')
                result = subprocess.run(['bash', str(root / 'update-all.sh')],
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, expected_status, result.stderr)
                self.assertEqual(events.read_text().splitlines(), ['stable-start', 'stable-end', 'nightly'])


if __name__ == '__main__':
    unittest.main()
