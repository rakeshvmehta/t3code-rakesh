# T3-RN

`rakesh/nightly` carries the custom sections, notes, and branding on top of an
upstream nightly release. Build it with:

```sh
bash scripts/rakesh/build-nightly.sh
```

The output is `release-rakesh-nightly/T3 Code (Rakesh Nightly).app`, bundle ID
`com.rakesh.t3code.nightly`. The version comes from the nightly tag already
merged into the checkout. The stable build keeps its existing identity and
output directory.

Install the nightly app while it is closed:

```sh
RAKESH_APP_NAME='T3 Code (Rakesh Nightly)' \
RAKESH_BUNDLE_ID='com.rakesh.t3code.nightly' \
RAKESH_SOURCE_APP="$PWD/release-rakesh-nightly/T3 Code (Rakesh Nightly).app" \
bash scripts/rakesh/install.sh '/Applications/T3 Code (Rakesh Nightly).app'
```

Both builds use the existing local chat database and Electron profile. Run
only one T3 app at a time. Neither app uses the upstream update feed.

## Scheduled updates

Enable both channels from the durable checkout that holds both local branches:

```sh
bash scripts/rakesh/install-launch-agent.sh both
```

The maintainer checks at 06:00, 06:30, 07:00 and 07:30 in the Mac's local time.
One job runs stable first, then nightly, so scheduled builds never overlap.
Nightly still runs if stable fails. Every slot looks for newly published releases;
unchanged releases do not rebuild. A staged installation is retried first.

Nightly carries forward custom changes from `rakesh/main`, merges the latest
published nightly, validates and builds the app, then publishes `rakesh/nightly`
and its upstream tag. Publication
retries use a receipt for the exact validated commit; unbuilt local changes
are never pushed by a no-update check. A partial staging copy is not installed.

Followers check at 07:00, 07:30, 08:00 and 08:30, fetch the published branches and
build/sign locally. A follower keeps checking its later slots if the maintainer
has not published yet. An open target app is restarted only when no chat is
active. Updating the closed app does not launch it beside another T3 app.

The shared job is `com.rakesh.t3code.release-update`. Installing it replaces the
separate stable/nightly jobs and the legacy stable job. It refuses to interrupt
a running updater and restores previous jobs if registration fails. Standalone
channel installers cannot add a duplicate schedule while the shared job exists.
The legacy `nightly-update.sh` entrypoint still means stable.

Channel logs remain `~/Library/Logs/t3code-rakesh/stable-update-YYYY-MM-DD.log`
and `~/Library/Logs/t3code-rakesh/t3rn-update-YYYY-MM-DD.log`. Nightly staging,
completion markers, and Slack incident state live separately under
`~/Library/Application Support/t3code-rakesh-nightly`. Slack delivery uses the
existing stable self-DM configuration, with T3-RN labels and independent
failure/recovery deduplication.

## Moving the maintainer later

The installer accepts an explicit role, even when an upstream remote exists:

```sh
bash scripts/rakesh/install-launch-agent.sh both maintain

# On follower Macs after the new maintainer is verified:
bash scripts/rakesh/install-launch-agent.sh both follow
```

Keep one publisher per branch. The maintainer needs local `rakesh/main` and
`rakesh/nightly` branches, GitHub push access, the merge helper's own login,
and a macOS build/signing environment. A Linux VM can coordinate source work
and tests, but the current full publication gate still needs a macOS runner.
Each follower needs only its own build/signing setup and GitHub read access.
Moving update maintenance does not require moving chat data or copying a
teammate's credentials. No VM is provisioned by this setup.
