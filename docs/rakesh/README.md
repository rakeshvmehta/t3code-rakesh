# T3 Code (Rakesh)

An unofficial personal fork of [T3 Code](https://github.com/pingdotgg/t3code)
that adds **custom sidebar sections**: create sections from the sidebar header,
drag chats into them (a chat keeps its project), collapse them, rename,
reorder or delete them. Everything else is upstream T3 Code, merged from each
stable release every night. Not affiliated with T3 Tools.

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

## Updates

A LaunchAgent pulls this repo at 05:00 and, if there is anything new, builds
and installs it (retrying every 30 minutes until 06:30 while a chat is still
working). The maintainer's Mac merges upstream at 04:00 and pushes here only
after the build and tests pass. Logs: `~/Library/Logs/t3code-rakesh/`.

## Good to know

- It shares chats, projects and settings with the official T3 Code app
  (`~/.t3/userdata`). Don't run both at once.
- Sidebar sections are stored on your Mac only.
- To roll back: quit the app, then replace `/Applications/T3 Code (Rakesh).app`
  with `/Applications/T3 Code (Rakesh).app.prev`.
- Uninstall: `launchctl bootout gui/$(id -u)/com.rakesh.t3code.nightly`,
  delete `~/Library/LaunchAgents/com.rakesh.t3code.nightly.plist` and the app.
