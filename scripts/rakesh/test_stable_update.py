import datetime
import json
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
        self.events = self.root / 'events'
        self.entry = 'stable-update.sh'
        self.log_prefix = 'stable-update'
        self.nightly_tag = 'v0.1.8-nightly.20261111.123'
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1',
                        GIT_CONFIG_GLOBAL='/dev/null',
                        GIT_AUTHOR_NAME='Test', GIT_AUTHOR_EMAIL='test@example.com',
                        GIT_COMMITTER_NAME='Test', GIT_COMMITTER_EMAIL='test@example.com',
                        RAKESH_UPDATE_STATE_DIR=str(self.state),
                        RAKESH_UPDATE_WORKTREE=str(self.root / 'worktree'),
                        RAKESH_UPDATE_INSTALL_TARGET=str(self.root / 'app'),
                        RAKESH_UPDATE_TAG='v0.1.7')
        self.git('init', '-q', '-b', 'main', str(self.upstream))
        scripts = self.upstream / 'scripts/rakesh'
        scripts.mkdir(parents=True)
        for name in ('stable-update.sh', 'release-update.sh', 't3rn-update.sh',
                     'build-nightly.sh', 'select-release.py'):
            source = Path(__file__).with_name(name)
            if source.exists():
                shutil.copyfile(source, scripts / name)
        (scripts / 'env.sh').write_text(f'''
RAKESH_REPO_ROOT="$(cd "$(dirname "${{BASH_SOURCE[0]}}")/../.." && pwd)"
RAKESH_LOG_DIR='{self.root / 'logs'}'
RAKESH_APP_NAME="${{RAKESH_APP_NAME:-Test T3}}"
RAKESH_INSTALL_PATH='{self.root / 'app'}'
RAKESH_BUNDLE_ID='test.t3'
rakesh_notify() {{ :; }}
rakesh_app_running() {{ return 1; }}
rakesh_other_app_running() {{ return 1; }}
curl() {{ return 0; }}
ditto() {{ cp -R "$1" "$2"; }}
''')
        (scripts / 'update-alerts.py').write_text(
            f'import json,sys\nwith open({str(self.events)!r}, "a") as f: '
            'f.write(json.dumps(sys.argv[1:]) + "\\n")\n')
        (scripts / 'install.sh').write_text('''#!/bin/bash
set -e
rm -rf "$1"
cp -R "$RAKESH_SOURCE_APP" "$1"
''')
        (scripts / 'install.sh').chmod(0o755)
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
        self.git('-C', str(self.upstream), 'tag', self.nightly_tag)
        self.today = datetime.date.today().isoformat()

    def git(self, *args):
        return subprocess.run(['git', *args], env=self.env, check=True,
                              capture_output=True, text=True).stdout.strip()

    def run_updater(self):
        return subprocess.run(['bash', str(self.repo / 'scripts/rakesh' / self.entry)],
                              env=self.env, capture_output=True, text=True, timeout=15)

    def log(self):
        path = self.root / 'logs' / f'{self.log_prefix}-{self.today}.log'
        return path.read_text() if path.exists() else 'Updater did not reach its log'

    def installed(self, version):
        import plistlib
        path = self.root / 'app/Contents/Info.plist'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(plistlib.dumps({'CFBundleShortVersionString': version}))

    def nightly(self):
        self.git('-C', str(self.repo), 'switch', '-qc', 'rakesh/nightly')
        self.env['RAKESH_UPDATE_TAG'] = self.nightly_tag
        self.entry = 't3rn-update.sh'
        self.log_prefix = 't3rn-update'

    def successful_build(self):
        script = self.repo / 'scripts/rakesh/build.sh'
        script.write_text(f'#!/bin/bash\nset -e\necho build >> "{self.builds}"\n' + '''python3 - <<'BUILD'
from pathlib import Path
import os, plistlib, subprocess
name = os.environ.get('RAKESH_APP_NAME', 'Test T3')
output = 'release-rakesh-nightly' if 'Nightly' in name else 'release-rakesh'
app = Path(output) / (name + '.app') / 'Contents'
app.mkdir(parents=True)
version = os.environ.get('RAKESH_BUILD_TAG', 'v0.1.7').removeprefix('v')
with (app / 'Info.plist').open('wb') as f:
    plistlib.dump({'CFBundleShortVersionString': version}, f)
(app / 'source-head').write_text(subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip())
BUILD
''')
        self.git('-C', str(self.repo), 'add', '.')
        self.git('-C', str(self.repo), 'commit', '-qm', 'test build boundary')

    def test_nightly_discards_partial_or_malformed_gh_response_before_fallback(self):
        self.nightly()
        del self.env['RAKESH_UPDATE_TAG']
        payload = json.dumps([{'tag_name': self.nightly_tag, 'prerelease': True,
                               'draft': False, 'published_at': '2026-11-11T03:00:00Z'}])
        env_file = self.repo / 'scripts/rakesh/env.sh'
        with env_file.open('a') as stream:
            stream.write(f"\ncurl() {{ printf '%s' '{payload}'; }}\n")
        for code in (1, 0):
            with self.subTest(gh_exit=code):
                with env_file.open('a') as stream:
                    stream.write(f"gh() {{ printf '%s' '[partial'; return {code}; }}\n")
                result = self.run_updater()
                self.assertEqual(result.returncode, 1, self.log())
                self.assertTrue(self.builds.exists(), self.log())
                self.assertIn('fetching nightly release ' + self.nightly_tag, self.log())
                self.builds.unlink()

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
        self.assertNotIn('refs/tags/' + self.nightly_tag, refs)
        self.assertNotIn('refs/remotes/upstream/nightly', refs)

    def test_repeated_checks_of_an_unchanged_release_do_not_rebuild(self):
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 'refs/tags/v0.1.7:refs/tags/v0.1.7')
        self.git('-C', str(self.repo), 'merge', '-q', '--ff-only', 'v0.1.7')
        self.installed('0.1.7')
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        self.assertFalse(self.builds.exists())

    def assert_later_release_is_discovered(self, nightly=False):
        if nightly:
            self.nightly()
        current_tag = self.env['RAKESH_UPDATE_TAG']
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 f'refs/tags/{current_tag}:refs/tags/{current_tag}')
        self.git('-C', str(self.repo), 'merge', '-q', '--ff-only', current_tag)
        self.installed(current_tag.removeprefix('v'))
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        later_tag = 'v0.1.8-nightly.20261111.456' if nightly else 'v0.1.8'
        self.git('-C', str(self.upstream), 'switch', '-q', 'nightly' if nightly else 'main')
        (self.upstream / 'later-release').write_text('published after the first check')
        self.git('-C', str(self.upstream), 'add', '.')
        self.git('-C', str(self.upstream), 'commit', '-qm', 'later release')
        self.git('-C', str(self.upstream), 'tag', later_tag)
        self.env['RAKESH_UPDATE_TAG'] = later_tag
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build'])

    def test_stable_discovers_a_later_release_after_a_successful_same_day_check(self):
        self.assert_later_release_is_discovered()

    def test_nightly_discovers_a_later_release_after_a_successful_same_day_check(self):
        self.assert_later_release_is_discovered(nightly=True)

    def test_nightly_build_failure_retries_without_advancing_source_or_installing(self):
        self.nightly()
        before = self.git('-C', str(self.repo), 'rev-parse', 'rakesh/nightly')
        for _ in range(2):
            result = self.run_updater()
            self.assertEqual(result.returncode, 1, result.stderr + self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build', 'build'])
        self.assertEqual(self.git('-C', str(self.repo), 'rev-parse', 'rakesh/nightly'), before)
        self.assertFalse((self.root / 'app').exists())

    def test_nightly_publishes_built_source_then_installs_its_own_app(self):
        self.successful_build()
        self.nightly()
        origin = self.root / 'origin'
        self.git('init', '-q', '--bare', str(origin))
        self.git('-C', str(self.repo), 'remote', 'add', 'origin', str(origin))
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        self.assertEqual(self.git('-C', str(origin), 'rev-parse', 'rakesh/nightly'),
                         self.git('-C', str(self.repo), 'rev-parse', 'rakesh/nightly'))
        self.assertIn('CFBundleShortVersionString', (self.root / 'app/Contents/Info.plist').read_text())
        import plistlib
        info = plistlib.loads((self.root / 'app/Contents/Info.plist').read_bytes())
        self.assertEqual(info['CFBundleShortVersionString'], '0.1.8-nightly.20261111.123')
        self.assertFalse((self.state / 'staged').exists())
        events = [json.loads(line) for line in self.events.read_text().splitlines()]
        installed = next(event for event in events if event[0] == 'installed')
        self.assertEqual(installed[installed.index('--product') + 1], 'T3-RN')

    def test_nightly_picks_up_custom_stable_changes_without_a_new_upstream_tag(self):
        self.successful_build()
        self.nightly()
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 f'refs/tags/{self.nightly_tag}:refs/tags/{self.nightly_tag}')
        self.git('-C', str(self.repo), 'merge', '-qm', 'existing nightly', self.nightly_tag)
        self.installed('0.1.8-nightly.20261111.123')
        self.git('-C', str(self.repo), 'switch', '-q', 'rakesh/main')
        (self.repo / 'custom-sections-improvement').write_text('preserve this')
        self.git('-C', str(self.repo), 'add', '.')
        self.git('-C', str(self.repo), 'commit', '-qm', 'custom improvement')
        custom_head = self.git('-C', str(self.repo), 'rev-parse', 'HEAD')
        self.git('-C', str(self.repo), 'switch', '-q', 'rakesh/nightly')
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        self.assertEqual((self.repo / 'custom-sections-improvement').read_text(), 'preserve this')
        self.git('-C', str(self.repo), 'merge-base', '--is-ancestor', custom_head, 'HEAD')
        self.assertTrue((self.root / 'app/Contents/Info.plist').exists())
        self.assertEqual((self.root / 'app/Contents/source-head').read_text(),
                         self.git('-C', str(self.repo), 'rev-parse', 'HEAD'))

    def test_no_update_check_does_not_publish_unbuilt_local_commits(self):
        self.nightly()
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 f'refs/tags/{self.nightly_tag}:refs/tags/{self.nightly_tag}')
        self.git('-C', str(self.repo), 'merge', '-qm', 'existing nightly', self.nightly_tag)
        self.installed('0.1.8-nightly.20261111.123')
        origin = self.root / 'origin'
        self.git('clone', '-q', '--bare', str(self.repo), str(origin))
        self.git('-C', str(self.repo), 'remote', 'add', 'origin', str(origin))
        published = self.git('-C', str(origin), 'rev-parse', 'rakesh/nightly')
        (self.repo / 'unbuilt-change').write_text('not validated')
        self.git('-C', str(self.repo), 'add', '.')
        self.git('-C', str(self.repo), 'commit', '-qm', 'unbuilt local change')
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        self.assertEqual(self.git('-C', str(origin), 'rev-parse', 'rakesh/nightly'), published)

    def test_failed_publication_retries_built_source_without_rebuilding(self):
        self.successful_build()
        self.nightly()
        origin = self.root / 'origin'
        self.git('init', '-q', '--bare', str(origin))
        self.git('-C', str(self.repo), 'remote', 'add', 'origin', str(self.root / 'offline'))
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        self.assertTrue((self.root / 'app/Contents/Info.plist').exists())
        self.git('-C', str(self.repo), 'remote', 'set-url', 'origin', str(origin))
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        published = subprocess.run(['git', '-C', str(origin), 'rev-parse', 'rakesh/nightly'],
                                   env=self.env, capture_output=True, text=True)
        self.assertEqual(published.returncode, 0, published.stderr)
        self.assertEqual(published.stdout.strip(), self.git('-C', str(self.repo), 'rev-parse', 'HEAD'))
        self.assertEqual(self.builds.read_text().splitlines(), ['build'])
        self.assertFalse((self.state / 'publish-ready').exists())

    def test_interrupted_staging_never_becomes_an_installable_partial_app(self):
        self.successful_build()
        self.nightly()
        with (self.repo / 'scripts/rakesh/env.sh').open('a') as stream:
            stream.write('''
ditto() { mkdir -p "$2/Contents"; echo incomplete >"$2/Contents/partial"; return 1; }
''')
        for _ in range(2):
            result = self.run_updater()
            self.assertEqual(result.returncode, 1, result.stderr + self.log())
        self.assertFalse((self.root / 'app').exists())
        self.assertFalse((self.state / 'staged').exists())

    def test_follower_sees_a_later_publication_after_an_earlier_no_update_check(self):
        self.git('-C', str(self.repo), 'remote', 'rename', 'upstream', 'origin')
        self.env['RAKESH_UPDATE_MODE'] = 'follow'
        self.git('-C', str(self.upstream), 'branch', 'rakesh/main', 'v0.1.3')
        self.installed('0.1.3')
        self.assertEqual(self.run_updater().returncode, 0, self.log())
        self.git('-C', str(self.upstream), 'branch', '-f', 'rakesh/main', 'v0.1.7')
        self.assertEqual(self.run_updater().returncode, 1, self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build'])

    def test_current_source_with_an_older_installed_app_is_rebuilt(self):
        self.git('-C', str(self.repo), 'fetch', '-q', '--no-tags', 'upstream',
                 'refs/tags/v0.1.7:refs/tags/v0.1.7')
        self.git('-C', str(self.repo), 'merge', '-q', '--ff-only', 'v0.1.7')
        self.installed('0.1.3')
        result = self.run_updater()
        self.assertEqual(result.returncode, 1, result.stderr + self.log())
        self.assertEqual(self.builds.read_text().splitlines(), ['build'])

    def test_update_does_not_move_a_branch_checked_out_in_another_worktree(self):
        self.successful_build()
        self.nightly()
        before = self.git('-C', str(self.repo), 'rev-parse', 'HEAD')
        self.git('-C', str(self.repo), 'switch', '-q', 'rakesh/main')
        other = self.root / 'user-worktree'
        self.git('-C', str(self.repo), 'worktree', 'add', '-q', str(other), 'rakesh/nightly')
        result = self.run_updater()
        self.assertEqual(result.returncode, 1, result.stderr + self.log())
        self.assertEqual(self.git('-C', str(other), 'rev-parse', 'HEAD'), before)
        self.assertFalse(self.builds.exists())

    def test_worktree_attached_during_build_is_not_changed_at_publication(self):
        self.successful_build()
        other = self.root / 'user-worktree'
        script = self.repo / 'scripts/rakesh/build.sh'
        with script.open('a') as stream:
            stream.write(f'\ngit -C "{self.repo}" worktree add -q "{other}" rakesh/nightly\n')
        self.git('-C', str(self.repo), 'add', '.')
        self.git('-C', str(self.repo), 'commit', '-qm', 'test branch attachment during build')
        self.nightly()
        before = self.git('-C', str(self.repo), 'rev-parse', 'HEAD')
        self.git('-C', str(self.repo), 'switch', '-q', 'rakesh/main')
        result = self.run_updater()
        self.assertEqual(result.returncode, 1, result.stderr + self.log())
        self.assertEqual(self.git('-C', str(other), 'rev-parse', 'HEAD'), before)
        self.assertFalse((self.state / 'staged').exists())

    def test_publication_resumes_after_exit_immediately_after_branch_advancement(self):
        self.successful_build()
        self.nightly()
        origin = self.root / 'origin'
        self.git('init', '-q', '--bare', str(origin))
        self.git('-C', str(self.repo), 'remote', 'add', 'origin', str(origin))
        interrupted = self.root / 'interrupted'
        hook = self.repo / '.git/hooks/post-merge'
        hook.write_text(f'''#!/bin/bash
if [[ "$PWD" -ef '{self.repo}' && ! -f '{interrupted}' ]]; then
  touch '{interrupted}'
  # This private fixture lock records the updater PID at startup.
  job_pid="$(cat '{self.state / 'nightly.lock/pid'}')"
  kill -KILL "$job_pid"
fi
''')
        hook.chmod(0o755)
        result = self.run_updater()
        self.assertEqual(result.returncode, -9, result.stderr + self.log())
        self.assertTrue((self.state / 'staged').exists())
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr + self.log())
        published = subprocess.run(['git', '-C', str(origin), 'rev-parse', 'rakesh/nightly'],
                                   env=self.env, capture_output=True, text=True)
        self.assertEqual(published.returncode, 0, published.stderr)
        self.assertEqual(published.stdout.strip(), self.git('-C', str(self.repo), 'rev-parse', 'HEAD'))
        self.assertTrue((self.root / 'app/Contents/Info.plist').exists())
        self.assertFalse((self.state / 'publish-ready').exists())


class ReleaseSelectionTest(unittest.TestCase):
    def test_selects_newest_published_nightly_and_excludes_stable_preview_and_draft(self):
        releases = [
            {'tag_name': 'v0.1.10-nightly.20261111.100', 'prerelease': True,
             'draft': False, 'published_at': '2026-11-11T01:00:00Z'},
            {'tag_name': 'v0.1.10-preview.20261111.200', 'prerelease': True,
             'draft': False, 'published_at': '2026-11-11T04:00:00Z'},
            {'tag_name': 'v0.1.9', 'prerelease': False,
             'draft': False, 'published_at': '2026-11-11T05:00:00Z'},
            {'tag_name': 'v0.1.10-nightly.20261111.300', 'prerelease': True,
             'draft': True, 'published_at': '2026-11-11T06:00:00Z'},
            {'tag_name': 'v0.1.10-nightly.20261111.150', 'prerelease': True,
             'draft': False, 'published_at': '2026-11-11T03:00:00Z'},
        ]
        result = subprocess.run(['python3', str(Path(__file__).with_name('select-release.py')),
                                 'nightly'], input=json.dumps(releases), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'v0.1.10-nightly.20261111.150')


if __name__ == '__main__':
    unittest.main()
