import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess


class FakeSlack:
    def __init__(self):
        self.messages = []
        self.error = None

    def find(self, text, receipt_id=None):
        return next((r for r in self.messages if r['text'] == text), None)

    def send(self, text, before_send=None, accepted=None):
        if before_send:
            before_send()
        if self.error:
            raise self.error
        receipt = {'id': f'Rm{len(self.messages) + 1}', 'text': text}
        self.messages.append(receipt)
        return receipt


class UpdateAlertsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'alerts.json'
        self.slack = FakeSlack()

    def run_event(self, event, **values):
        return alerts.handle_event(self.path, self.slack, event,
                                   installed='0.1.3', target='v0.1.7',
                                   stage='validation', log='/local/log.txt', **values)

    def test_repeated_failures_send_one_incoming_alert(self):
        self.run_event('failure')
        self.run_event('failure')
        self.run_event('flush')
        self.assertEqual(len(self.slack.messages), 1)
        self.assertIn('0.1.3', self.slack.messages[0]['text'])
        self.assertIn('v0.1.7', self.slack.messages[0]['text'])

    def test_only_an_install_after_failure_sends_recovery_once(self):
        self.run_event('installed')
        self.assertEqual(self.slack.messages, [])
        self.run_event('failure')
        self.run_event('flush')
        self.assertEqual(len(self.slack.messages), 1)
        self.run_event('installed')
        self.run_event('installed')
        self.assertEqual(len(self.slack.messages), 2)
        self.assertIn('recovered', self.slack.messages[-1]['text'])

    def test_new_incident_after_recovery_alerts_again(self):
        self.run_event('failure')
        self.run_event('installed')
        self.run_event('failure')
        self.assertEqual(len(self.slack.messages), 3)
        self.assertNotEqual(self.slack.messages[0]['text'], self.slack.messages[2]['text'])

    def test_nightly_alerts_and_recovery_keep_the_stable_incident_open(self):
        self.run_event('failure')
        nightly_path = Path(self.temp.name) / 'nightly.json'
        details = {'installed': '0.1.8-nightly.20261111.123',
                   'target': 'v0.1.8-nightly.20261111.124', 'stage': 'build',
                   'log': '/local/nightly.log', 'product': 'T3-R (Nightly)'}
        alerts.handle_event(nightly_path, self.slack, 'failure', **details)
        alerts.handle_event(nightly_path, self.slack, 'installed', **details)
        self.assertEqual(len(self.slack.messages), 3)
        self.assertTrue(self.slack.messages[1]['text'].startswith('T3-R (Nightly) update failed'))
        self.assertTrue(self.slack.messages[2]['text'].startswith('T3-R (Nightly) update recovered'))
        self.assertIsNotNone(json.loads(self.path.read_text())['incident'])
        self.assertIsNone(json.loads(nightly_path.read_text())['incident'])

    def test_nightly_cli_shares_configuration_but_writes_only_its_own_state(self):
        shared = Path(self.temp.name) / 'stable/slack-alerts.json'
        shared.parent.mkdir()
        config = {'account_id': 'TEST_ACCOUNT', 'team_id': 'TEST_TEAM',
                  'user_id': 'TEST_USER', 'channel_id': 'TEST_DM', 'composio_bin': '/unused'}
        shared.write_text(json.dumps(config))
        nightly = Path(self.temp.name) / 'nightly'
        result = subprocess.run(['python3', str(Path(__file__).with_name('update-alerts.py')),
                                 'flush', '--state-dir', str(nightly), '--config', str(shared),
                                 '--product', 'T3-R (Nightly)'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((nightly / 'slack-alert-state.json').exists())
        self.assertFalse((shared.parent / 'slack-alert-state.json').exists())
        self.assertEqual(json.loads(shared.read_text()), config)

    def test_definite_rejection_is_saved_and_retried(self):
        self.slack.error = alerts.Rejected('missing_scope')
        with self.assertRaises(alerts.Rejected):
            self.run_event('failure')
        self.slack.error = None
        self.run_event('flush')
        self.assertEqual(len(self.slack.messages), 1)

    def test_ambiguous_send_is_reconciled_without_duplicate(self):
        real_send = self.slack.send

        def accepted_then_timeout(text, **callbacks):
            real_send(text, **callbacks)
            raise alerts.Uncertain('timeout')

        self.slack.send = accepted_then_timeout
        with self.assertRaises(alerts.Uncertain):
            self.run_event('failure')
        self.slack.send = real_send
        self.run_event('flush')
        self.assertEqual(len(self.slack.messages), 1)
        self.assertEqual(json.loads(self.path.read_text())['outbox'][0]['status'], 'sent')

    def test_unknown_delivery_is_not_blindly_retried(self):
        self.slack.error = alerts.Uncertain('timeout')
        with self.assertRaises(alerts.Uncertain):
            self.run_event('failure')
        self.slack.error = None
        with self.assertRaises(alerts.Uncertain):
            self.run_event('flush')
        self.assertEqual(self.slack.messages, [])

    def test_crash_after_recording_attempt_is_not_resent(self):
        self.slack.error = alerts.Uncertain('timeout')
        with self.assertRaises(alerts.Uncertain):
            self.run_event('failure')
        data = json.loads(self.path.read_text())
        data['outbox'][0]['status'] = 'sending'
        self.path.write_text(json.dumps(data))
        self.slack.error = None
        with self.assertRaises(alerts.Uncertain):
            self.run_event('flush')
        self.assertEqual(self.slack.messages, [])

    def test_failed_alert_then_install_does_not_send_stale_failure(self):
        self.slack.error = alerts.Rejected('offline')
        with self.assertRaises(alerts.Rejected):
            self.run_event('failure')
        self.slack.error = None
        self.run_event('installed')
        self.assertEqual(len(self.slack.messages), 1)
        self.assertIn('recovered', self.slack.messages[0]['text'])

    def test_preflight_timeout_stays_retryable_and_records_safe_reason(self):
        slack = alerts.ComposioSlack({'channel_id': 'D_SELF'})
        def timeout():
            raise alerts.Uncertain('Composio auth.test timed out after 20 seconds')
        slack.verify_identity = timeout
        with self.assertRaises(alerts.Uncertain):
            alerts.handle_event(self.path, slack, 'failure', installed='0.1.3',
                                target='v0.1.7', stage='discovery', log='/local/log.txt')
        item = json.loads(self.path.read_text())['outbox'][0]
        self.assertEqual(item['status'], 'pending')
        self.assertIn('auth.test', item['last_error'])
        slack.verify_identity = lambda: None
        slack.call = lambda *a, **kw: {'ok': True, 'channel': 'D_SELF', 'ts': '123.4'}
        text = item['text']
        slack.execute = lambda *a, **kw: {'ok': True, 'messages': [{'ts': '123.4', 'text': text}]}
        alerts.handle_event(self.path, slack, 'flush')
        self.assertEqual(json.loads(self.path.read_text())['outbox'][0]['status'], 'sent')

    def test_accepted_receipt_is_saved_even_if_history_readback_times_out(self):
        slack = alerts.ComposioSlack({'channel_id': 'D_SELF'})
        slack.verify_identity = lambda: None
        slack.call = lambda *a, **kw: {'ok': True, 'channel': 'D_SELF', 'ts': '123.4'}
        def timeout(*a, **kw):
            raise alerts.Uncertain('Composio history timed out after 20 seconds')
        slack.execute = timeout
        with self.assertRaises(alerts.Uncertain):
            alerts.handle_event(self.path, slack, 'failure', installed='0.1.3',
                                target='v0.1.7', stage='discovery', log='/local/log.txt')
        item = json.loads(self.path.read_text())['outbox'][0]
        self.assertEqual(item['status'], 'uncertain')
        self.assertEqual(item.get('receipt_id'), '123.4')

    def test_delivery_reconciles_from_saved_dm_history(self):
        slack = alerts.ComposioSlack({'user_id': 'U_SELF', 'team_id': 'T_ZARNA',
                                      'channel_id': 'D_SELF'})
        slack.verify_identity = lambda: None

        def execute(slug, payload, mutating=False):
            if slug == 'SLACK_FETCH_CONVERSATION_HISTORY':
                return {'ok': True, 'messages': [{'user': 'U_SELF', 'ts': '123.4',
                         'text': 'Alert [T3-R incident failure]'}], 'has_more': False}
            raise AssertionError(slug)

        slack.execute = execute
        self.assertIsNotNone(slack.find('Alert [T3-R incident failure]'))

    def test_wrong_workspace_cannot_send_an_alert(self):
        slack = alerts.ComposioSlack({'user_id': 'U_SELF', 'team_id': 'T_ZARNA'})
        slack.call = lambda *a, **kw: {'ok': True, 'user_id': 'U_SELF', 'team_id': 'T_OTHER'}
        with self.assertRaises(alerts.Rejected):
            slack.send('Alert')

    def test_other_persons_dm_cannot_receive_an_alert(self):
        slack = alerts.ComposioSlack({'user_id': 'U_SELF', 'team_id': 'T_ZARNA',
                                      'channel_id': 'D_OTHER'})

        def call(arguments, mutating=False):
            if arguments[1].endswith('auth.test'):
                return {'ok': True, 'user_id': 'U_SELF', 'team_id': 'T_ZARNA'}
            self.fail('No message may be sent to another person')

        slack.call = call
        slack.execute = lambda *a, **kw: {'ok': True, 'channel': {
            'id': 'D_OTHER', 'is_im': True, 'user': 'U_OTHER'}}
        with self.assertRaises(alerts.Rejected):
            slack.send('Alert')

    def test_message_is_read_back_before_marking_delivery_confirmed(self):
        slack = alerts.ComposioSlack({'user_id': 'U_SELF', 'team_id': 'T_ZARNA',
                                      'channel_id': 'D_SELF'})
        slack.verify_identity = lambda: None
        slack.call = lambda *a, **kw: {'ok': True, 'channel': 'D_SELF', 'ts': '123.4',
                                       'message': {'text': 'Alert'}}

        def execute(slug, payload, mutating=False):
            if slug == 'SLACK_FETCH_CONVERSATION_HISTORY':
                return {'ok': True, 'messages': [{'ts': '123.4', 'text': 'Alert'}]}
            raise AssertionError(slug)

        slack.execute = execute
        self.assertEqual(slack.send('Alert')['id'], '123.4')

    def test_readback_failure_after_send_is_uncertain_not_rejected(self):
        slack = alerts.ComposioSlack({'user_id': 'U_SELF', 'team_id': 'T_ZARNA',
                                      'channel_id': 'D_SELF'})
        slack.verify_identity = lambda: None
        slack.call = lambda *a, **kw: {'ok': True, 'channel': 'D_SELF', 'ts': '123.4',
                                       'message': {'text': 'Alert'}}

        def execute(*args, **kwargs):
            raise alerts.Rejected('offline')

        slack.execute = execute
        with self.assertRaises(alerts.Uncertain):
            slack.send('Alert')


class UpdaterIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.scripts = self.root / 'scripts/rakesh'
        self.scripts.mkdir(parents=True)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.events = self.root / 'events'
        (self.scripts / 'stable-update.sh').write_text(
            Path(__file__).with_name('stable-update.sh').read_text())
        release_update = Path(__file__).with_name('release-update.sh')
        if release_update.exists():
            (self.scripts / release_update.name).write_bytes(release_update.read_bytes())
        (self.scripts / 'env.sh').write_text(f'''
RAKESH_REPO_ROOT='{self.root}'
RAKESH_LOG_DIR='{self.root / 'logs'}'
RAKESH_APP_NAME='Test T3'
RAKESH_INSTALL_PATH='{self.root / 'app'}'
RAKESH_BUNDLE_ID='test.t3'
rakesh_notify() {{ :; }}
rakesh_app_running() {{ return 1; }}
git() {{ case "$*" in *'rev-parse --verify'*) return 0;; *'remote get-url upstream'*) return 0;; *'fetch upstream'*) return 0;; *'worktree list'*) return 0;; *) return 1;; esac; }}
curl() {{ return 0; }}
ditto() {{ cp -R "$1" "$2"; }}
''')
        (self.scripts / 'update-alerts.py').write_text(
            f'import sys\nwith open({str(self.events)!r}, "a") as f: f.write(sys.argv[1] + "\\n")\n'
            'sys.exit(1)\n')
        (self.scripts / 'install.sh').write_text('#!/bin/bash\nexit 0\n')
        (self.scripts / 'install.sh').chmod(0o755)

    def run_updater(self):
        import os
        env = dict(os.environ, RAKESH_UPDATE_STATE_DIR=str(self.state),
                   RAKESH_UPDATE_INSTALL_TARGET=str(self.root / 'app'),
                   RAKESH_UPDATE_TAG='invalid-tag',
                   RAKESH_UPDATE_WORKTREE=str(self.root / 'update-worktree'))
        return subprocess.run(['bash', str(self.scripts / 'stable-update.sh')],
                              env=env, capture_output=True, text=True, timeout=10)

    def test_update_failure_alert_does_not_replace_the_failure_exit(self):
        result = self.run_updater()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(self.events.exists(), 'Missing updater alert event')
        self.assertIn('failure', self.events.read_text().splitlines())

    def test_only_installed_staged_build_generates_recovery_event(self):
        staged = self.state / 'staged'
        (staged / 'Test T3.app').mkdir(parents=True)
        (staged / 'tag').write_text('v0.1.7')
        result = self.run_updater()
        self.assertEqual(result.returncode, 0)
        self.assertTrue(self.events.exists(), 'Missing installed alert event')
        self.assertIn('installed', self.events.read_text().splitlines())
        self.assertFalse(staged.exists())

    def test_same_day_check_flushes_alerts_and_reports_a_new_failure(self):
        import datetime
        (self.state / 'last-success').write_text(datetime.date.today().isoformat())
        result = self.run_updater()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(self.events.exists(), 'Missing pending-alert flush')
        self.assertEqual(self.events.read_text().splitlines(), ['flush', 'failure'])

    def test_failed_install_alerts_and_keeps_the_staged_build(self):
        staged = self.state / 'staged'
        (staged / 'Test T3.app').mkdir(parents=True)
        (staged / 'tag').write_text('v0.1.7')
        (self.scripts / 'install.sh').write_text('#!/bin/bash\nexit 1\n')
        result = self.run_updater()
        self.assertEqual(result.returncode, 0)
        self.assertIn('failure', self.events.read_text().splitlines())
        self.assertNotIn('installed', self.events.read_text().splitlines())
        self.assertTrue(staged.exists())


if __name__ == '__main__':
    spec = importlib.util.spec_from_file_location('update_alerts',
            Path(__file__).with_name('update-alerts.py'))
    alerts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(alerts)
    unittest.main()
