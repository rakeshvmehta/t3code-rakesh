import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


class Rejected(Exception):
    pass


class Uncertain(Exception):
    pass


def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.new')
    with temporary.open('w') as stream:
        os.chmod(temporary, 0o600)
        json.dump(state, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def handle_event(path, slack, event, **details):
    state = json.loads(path.read_text()) if path.exists() else {'incident': None, 'outbox': []}
    incident = state['incident']
    if event == 'failure' and incident is None:
        incident = uuid.uuid4().hex[:12]
        state['incident'] = incident
        text = (f"T3-R update failed at {details['stage']}. "
                f"Installed: {details['installed']}; requested: {details['target']}. "
                f"The update did not finish. Log on your Mac: {details['log']}.")
        state['outbox'].append({'kind': 'failure', 'incident': incident, 'status': 'pending',
                                'text': f'{text} [T3-R {incident} failure]'})
    elif event == 'installed' and incident is not None:
        # A rejected failure should not arrive after its successful installation.
        for item in state['outbox']:
            if item['incident'] == incident and item['status'] == 'pending':
                item['status'] = 'superseded'
        text = (f"T3-R update recovered: {details['installed']} is installed. "
                f"Log on your Mac: {details['log']}.")
        state['outbox'].append({'kind': 'recovery', 'incident': incident, 'status': 'pending',
                                'text': f'{text} [T3-R {incident} recovery]'})
        state['incident'] = None
    save(path, state)
    for item in state['outbox']:
        if item['status'] in ('sent', 'superseded'):
            continue
        if item['status'] in ('sending', 'uncertain'):
            receipt = slack.find(item['text'])
            if receipt is None:
                raise Uncertain('Prior send has no confirmed receipt; not sending again')
        else:
            # Record the attempt before a provider call so a crash cannot replay it.
            item['status'] = 'sending'
            save(path, state)
            try:
                receipt = slack.send(item['text'])
            except Rejected:
                item['status'] = 'pending'
                save(path, state)
                raise
            except Exception:
                item['status'] = 'uncertain'
                save(path, state)
                raise
        item.update(status='sent', receipt_id=receipt['id'])
        save(path, state)
    return state


class ComposioSlack:
    def __init__(self, config):
        self.config = config

    def call(self, arguments, mutating=False):
        command = [self.config['composio_bin'], *arguments, '--account', self.config['account_id']]
        try:
            result = subprocess.run(command, stdin=subprocess.DEVNULL,
                                    capture_output=True, text=True, timeout=20)
            response = json.loads(result.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            raise Uncertain('Composio returned no conclusive result') from error
        except OSError as error:
            raise Rejected('Composio CLI could not start') from error
        data = response.get('data', response)
        if response.get('successful') is False or data.get('ok') is False:
            code = data.get('error', response.get('error', 'provider_rejected'))
            if mutating and code not in ('missing_scope', 'invalid_auth', 'not_authed',
                                         'account_inactive', 'token_revoked', 'ratelimited',
                                         'invalid_time', 'invalid_user', 'user_not_found'):
                raise Uncertain('Slack delivery outcome needs reconciliation')
            raise Rejected('Slack rejected the request')
        if result.returncode != 0:
            raise Uncertain('Composio exited without a successful result')
        return data

    def verify_identity(self):
        identity = self.call(['proxy', 'https://slack.com/api/auth.test', '--toolkit', 'slack',
                              '--method', 'POST', '--data', '{}'])
        if (identity.get('user_id'), identity.get('team_id')) != (
                self.config['user_id'], self.config['team_id']):
            raise Rejected('Slack connection does not match the configured recipient/workspace')
        data = self.execute('SLACK_OPEN_DM', {'users': self.config['user_id'],
                            'return_im': True, 'prevent_creation': True})
        channel = data.get('channel', {})
        if (not channel.get('is_im') or channel.get('user') != self.config['user_id']
                or channel.get('id') != self.config['channel_id']):
            raise Rejected('Alert destination is not the configured user self-DM')

    def execute(self, slug, payload, mutating=False):
        return self.call(['execute', slug, '-d', json.dumps(payload)], mutating=mutating)

    def send(self, text):
        self.verify_identity()
        payload = {'channel': self.config['channel_id'], 'text': text,
                   'client_msg_id': str(uuid.uuid5(uuid.NAMESPACE_URL, text)),
                   'unfurl_links': False, 'unfurl_media': False}
        data = self.call(['proxy', 'https://slack.com/api/chat.postMessage', '--toolkit',
                          'slack', '--method', 'POST', '--data', json.dumps(payload)],
                         mutating=True)
        if data.get('channel') != self.config['channel_id'] or not data.get('ts'):
            raise Uncertain('Slack returned an unexpected message receipt')
        try:
            history = self.execute('SLACK_FETCH_CONVERSATION_HISTORY', {
                'channel': self.config['channel_id'], 'oldest': data['ts'],
                'latest': data['ts'], 'inclusive': True, 'limit': 1})
            if not any(m.get('ts') == data['ts'] and m.get('text') == text
                       for m in history.get('messages', [])):
                raise Uncertain('Message not confirmed in DM history')
        except Rejected as error:
            raise Uncertain('Message accepted but readback failed') from error
        return {'id': data['ts'], 'text': text}

    def find(self, text):
        self.verify_identity()
        cursor = None
        for _ in range(3):
            payload = {'channel': self.config['channel_id'], 'limit': 100}
            if cursor:
                payload['cursor'] = cursor
            data = self.execute('SLACK_FETCH_CONVERSATION_HISTORY', payload)
            for message in data.get('messages', []):
                if message.get('text') == text:
                    return {'id': message['ts'], 'text': text}
            cursor = data.get('response_metadata', {}).get('next_cursor')
            if not cursor:
                break
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('event', choices=['failure', 'installed', 'flush'])
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--installed', default='unknown')
    parser.add_argument('--target', default='unknown')
    parser.add_argument('--stage', default='update')
    parser.add_argument('--log', default='~/Library/Logs/t3code-rakesh/')
    args = parser.parse_args()
    config_path = args.state_dir / 'slack-alerts.json'
    if not config_path.exists():
        return 0
    try:
        config = json.loads(config_path.read_text())
        for key in ('account_id', 'team_id', 'user_id', 'channel_id', 'composio_bin'):
            if not isinstance(config.get(key), str) or not config[key]:
                raise Rejected('Incomplete Slack alert configuration')
        with (args.state_dir / 'slack-alerts.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle_event(args.state_dir / 'slack-alert-state.json', ComposioSlack(config),
                         args.event, installed=args.installed, target=args.target,
                         stage=args.stage, log=args.log)
    except (Rejected, Uncertain, OSError, ValueError, KeyError) as error:
        # Provider output can contain credentials or raw logs; never echo it.
        print(f'T3-R Slack alert pending ({type(error).__name__}); see local alert state',
              file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
