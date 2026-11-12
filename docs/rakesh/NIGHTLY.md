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
only one T3 app at a time. This first nightly build has no upstream update
feed or separate scheduled updater; the stable-release updater stays on
`rakesh/main`.
