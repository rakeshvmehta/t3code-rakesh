import datetime
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class StableUpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.upstream = self.root / 'upstream'
        self.repo = self.root / 'repo'
        self.state = self.root / 'state'
        self.state.mkdir()
        self.builds = self.root / 'builds'
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1',
                        GIT_CONFIG_GLOBAL='/dev/null',
                        GIT_AUTHOR_NAME='Test', GIT_AUTHOR_EMAIL='test@example.com',
                        GIT_COMMITTER_NAME='Test', GIT_COMMITTER_EMAIL='test@example.com',
                        RAKESH_UPDATE_STATE_DIR=str(self.state),
                        RAKESH_UPDATE_WORKTREE=str(self.root / 'worktree'),
                        RAKESH_UPDATE_TAG='v0.1.7')
        self.git('init', '-q', '-b', 'main', str(self.upstream))
        scripts = self.upstream / 'scripts/rakesh'
        scripts.mkdir(parents=True)
        shutil.copyfile(Path(__file__).with_name('stable-update.sh'),
                        scripts / 'stable-update.sh')
        (scripts / 'env.sh').write_text(f'''
RAKESH_REPO_ROOT="$(cd "$(dirname "${{BASH_SOURCE[0]}}")/../.." && pwd)"
RAKESH_LOG_DIR='{self.root / 'logs'}'
RAKESH_APP_NAME='Test T3'
RAKESH_INSTALL_PATH='{self.root / 'app'}'
RAKESH_BUNDLE_ID='test.t3'
rakesh_notify() {{ :; }}
rakesh_app_running() {{ return 1; }}
curl() {{ return 0; }}
''')
        (scripts / 'update-alerts.py').write_text('')
        (scripts / 'build.sh').write_text(
            f'#!/bin/bash\necho build >> "{self.builds}"\nexit 1\n')
        (scripts / 'build.sh').chmod(0o755)
        self.git('-C', str(self.upstream), 'add', '.')
        self.git('-C', str(self.upstream), 'commit', '-qm', 'base')
        self.git('-C', str(self.upstream), 'tag', 'v0.1.3')
        self.git('clone', '-q', '--no-tags', str(self.upstream), str(self.repo))
        self.git('-C', str(self.repo), 'remote', 'rename', 'origin', 'upstream')
        self.git('-C', str(self.repo), 'switch', '-qc', 'rakesh/main')
        (self.upstream / 'release').write_text('stable')
        self.git('-C', str(self.upstream), 'add', '.')
        self.git('-C', str(self.upstream), 'commit', '-qm', 'stable release')
        self.git('-C', str(self.upstream), 'tag', 'v0.1.7')
        self.git('-C', str(self.upstream), 'switch', '-qc', 'nightly')
        (self.upstream / 'nightly-only').write_text('nightly')
        self.git('-C', str(self.upstream), 'add', '.')
        self.git('-C', str(self.upstream), 'commit', '-qm', 'nightly only')
        self.git('-C', str(self.upstream), 'tag', 'v0.1.8-nightly.test')
        self.today = datetime.date.today().isoformat()

    def git(self, *args):
        return subprocess.run(['git', *args], env=self.env, check=True,
                              capture_output=True, text=True).stdout.strip()

    def run_updater(self):
        return subprocess.run(['bash', str(self.repo / 'scripts/rakesh/stable-update.sh')],
                              env=self.env, capture_output=True, text=True, timeout=15)

    def log(self):
        return (self.root / 'logs' / f'stable-update-{self.today}.log').read_text()

    def test_failed_build_is_retried_in_the_same_day(self):
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build', 'build'])

    def test_legacy_attempt_marker_does_not_suppress_a_new_attempt(self):
        (self.state / 'last-run').write_text(self.today)
        result = self.run_updater()
        self.assertEqual(result.returncode, 1, self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build'])

    def test_follower_retries_a_failed_build_in_the_same_day(self):
        self.git('-C', str(self.repo), 'remote', 'rename', 'upstream', 'origin')
        self.env['RAKESH_UPDATE_MODE'] = 'follow'
        self.git('-C', str(self.upstream), 'branch', 'rakesh/main', 'v0.1.7')
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build', 'build'])

    def test_failed_merge_helper_does_not_block_the_next_attempt(self):
        (self.repo / 'release').write_text('custom')
        self.git('-C', str(self.repo), 'add', '.')
        self.git('-C', str(self.repo), 'commit', '-qm', 'custom change')
        docs = self.repo / 'docs/rakesh'
        docs.mkdir(parents=True)
        (docs / 'MERGE_INSTRUCTIONS.md').write_text('Test merge helper')
        attempts = self.root / 'helper-attempts'
        helper = self.root / 'helper'
        helper.write_text(f'#!/bin/bash\ncat >/dev/null\necho attempt >> "{attempts}"\nexit 1\n')
        helper.chmod(0o755)
        self.env['RAKESH_CLAUDE_BIN'] = str(helper)
        for _ in range(2):
            self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(attempts.read_text().splitlines(), ['attempt', 'attempt'])
        self.assertFalse(self.builds.exists())

    def test_stable_check_does_not_fetch_unrelated_branches_or_nightly_tags(self):
        self.run_updater()
        refs = self.git('-C', str(self.repo), 'for-each-ref', '--format=%(refname)')
        self.assertIn('refs/tags/v0.1.7', refs)
        self.assertNotIn('refs/tags/v0.1.8-nightly.test', refs)
        self.assertNotIn('refs/remotes/upstream/nightly', refs)

    def test_successful_no_update_check_skips_repeated_work(self):
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 'refs/tags/v0.1.7:refs/tags/v0.1.7')
        self.git('-C', str(self.repo), 'merge', '-q', '--ff-only', 'v0.1.7')
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        self.git('-C', str(self.repo), 'remote', 'set-url', 'upstream',
                 str(self.root / 'offline'))
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        self.assertFalse(self.builds.exists())


if __name__ == '__main__':
    unittest.main()
