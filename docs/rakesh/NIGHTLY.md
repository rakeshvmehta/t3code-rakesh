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

Enable T3-RN updates from the durable checkout that holds both local branches:

```sh
bash scripts/rakesh/install-launch-agent.sh nightly
```

The maintainer checks at02:00,02:30,03:00,and03:30. It carries forward custom
changes from `rakesh/main`, merges the latest published nightly, validates and
builds the app, then publishes `rakesh/nightly` and its upstream tag. Publication
retries use a receipt for the exact validated commit; unbuilt local changes
are never pushed by a no-update check. A partial staging copy is not installed.

Followers check at03:00,03:30,04:00,and04:30, fetch the published branch and
build/sign locally. A follower keeps checking its later slots if the maintainer
has not published yet. An open target app is restarted only when no chat is
active. Updating the closed app does not launch it beside another T3 app.

The job is `com.rakesh.t3code.t3rn-update`; logs are
`~/Library/Logs/t3code-rakesh/t3rn-update-YYYY-MM-DD.log`. Nightly staging,
completion markers, and Slack incident state live separately under
`~/Library/Application Support/t3code-rakesh-nightly`. Slack delivery uses the
existing stable self-DM configuration, with T3-RN labels and independent
failure/recovery deduplication. Existing stable jobs and the legacy
`nightly-update.sh` stable alias retain their behavior.

## Moving the maintainer later

The installer accepts an explicit role, even when an upstream remote exists:

```sh
bash scripts/rakesh/install-launch-agent.sh stable maintain
bash scripts/rakesh/install-launch-agent.sh nightly maintain

# On follower Macs after the new maintainer is verified:
bash scripts/rakesh/install-launch-agent.sh stable follow
bash scripts/rakesh/install-launch-agent.sh nightly follow
```

Keep one publisher per branch. The maintainer needs local `rakesh/main` and
`rakesh/nightly` branches, GitHub push access, the merge helper's own login,
and a macOS build/signing environment. A Linux VM can coordinate source work
and tests, but the current full publication gate still needs a macOS runner.
Each follower needs only its own build/signing setup and GitHub read access.
Moving update maintenance does not require moving chat data or copying a
teammate's credentials. No VM is provisioned by this setup.
