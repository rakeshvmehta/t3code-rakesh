# T3 Code (Rakesh)

An unofficial personal fork of [T3 Code](https://github.com/pingdotgg/t3code)
that adds **custom sidebar sections**: create sections from the sidebar header,
drag chats into them (a chat keeps its project), collapse them, rename,
reorder or delete them. Everything else is upstream T3 Code, merged from each
stable release on a daily schedule. Not affiliated with T3 Tools.

The branch is `rakesh/main`; our changes are the `rakesh:` commits. The app
installs as **T3 Code (Rakesh)** (`com.rakesh.t3code`) next to the official
app, with the "T3-R" icon.

## Install (Apple Silicon Mac)

You need the Xcode Command Line Tools (`xcode-select --install`) and
[Homebrew](https://brew.sh). Then:

```sh
git clone -b rakesh/main https://github.com/rakeshvmehta/t3code-rakesh.git ~/Developer/t3code-rakesh
~/Developer/t3code-rakesh/scripts/rakesh/setup.sh
```

The first build takes about 10 minutes. Then open **T3 Code (Rakesh)** from
Applications. On first launch macOS asks for your password to let it use the
"t3code Safe Storage" keychain item; choose **Always Allow**. That happens once.

## Scheduled updates

For both stable and nightly, use `scripts/rakesh/install-launch-agent.sh both`.
The maintainer runs stable then nightly at 04:00, with further checks every
30 minutes through 05:30. Followers use 05:00 through 06:30. Every slot looks
for new releases and skips rebuilding unchanged apps. This replaces separate
channel jobs; see [T3-R nightly setup](NIGHTLY.md) for branch prerequisites and VM roles.
Re-running setup preserves an existing combined job and its role.

A stable-only installation keeps its original schedule: a LaunchAgent pulls
this repo at 05:00 and, if there is anything new, builds
and installs it (retrying every 30 minutes until 06:30 while a chat is still
working). The maintainer's Mac merges upstream at 04:00 and pushes here only
after the build and tests pass. Logs: `~/Library/Logs/t3code-rakesh/stable-update-YYYY-MM-DD.log`.
The updater runs `scripts/rakesh/stable-update.sh`; it follows stable releases,
not the upstream nightly build channel. Existing installs can run
`scripts/rakesh/install-launch-agent.sh` once to migrate the scheduled job name.
The old `nightly-update.sh` entrypoint remains compatible until then.

Optional Slack DMs use the signed-in Composio CLI. Local configuration lives in
`~/Library/Application Support/t3code-rakesh/slack-alerts.json` with
`account_id`, `team_id`, `user_id`, `channel_id` (your self-DM), and the absolute
`composio_bin` path. No credentials belong in that file or this repository.
The updater checks the account and recipient before sending. It sends one
failure notice per unresolved update incident and one recovery notice after
installation. Pending alerts retry on scheduled runs; ambiguous sends are
checked against DM history before any resend. Mac notifications remain enabled.

## Good to know

- It shares chats, projects and settings with the official T3 Code app
  (`~/.t3/userdata`). Don't run both at once.
- Sidebar sections are stored on your Mac only.
- To roll back: quit the app, then replace `/Applications/T3 Code (Rakesh).app`
  with `/Applications/T3 Code (Rakesh).app.prev`.
- Uninstall a combined schedule with
  `launchctl bootout gui/$(id -u)/com.rakesh.t3code.release-update`, then delete
  `~/Library/LaunchAgents/com.rakesh.t3code.release-update.plist` and the apps.
  Stable-only installs use `com.rakesh.t3code.stable-update` instead.
