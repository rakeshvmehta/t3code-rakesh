import json
import re
import sys


def select_release(releases, channel):
    pattern = (r'v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+'
               if channel == 'nightly' else r'v\d+\.\d+\.\d+')
    candidates = [release for release in releases
                  if not release.get('draft', False)
                  and release.get('prerelease', False) == (channel == 'nightly')
                  and re.fullmatch(pattern, release.get('tag_name', ''))]
    if not candidates:
        raise ValueError('No published release matches the requested channel')
    return max(candidates, key=lambda release: release.get('published_at') or '')['tag_name']


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('stable', 'nightly'):
        raise SystemExit('Expected stable or nightly')
    try:
        print(select_release(json.load(sys.stdin), sys.argv[1]))
    except (KeyError, TypeError, ValueError) as error:
        raise SystemExit(str(error))
