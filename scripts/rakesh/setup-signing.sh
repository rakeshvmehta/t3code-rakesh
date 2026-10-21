#!/usr/bin/env bash
# One-time: creates a personal self-signed code-signing identity in its own
# keychain, so build.sh can sign every build with the same identity. macOS then
# keeps the app's keychain approval ("t3code Safe Storage") across updates.
# No Apple Developer account needed. Safe to re-run; it exits if already set up.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

kc="$RAKESH_SIGNING_KEYCHAIN"
if [[ -e "$kc" ]]; then
  echo "setup-signing.sh: $kc already exists"
  exit 0
fi
dir="$(dirname "$RAKESH_SIGNING_PASSWORD_FILE")"
mkdir -p "$dir"
chmod 700 "$dir"
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

openssl rand -hex 24 | tr -d '\n' >"$RAKESH_SIGNING_PASSWORD_FILE"
pw="$(cat "$RAKESH_SIGNING_PASSWORD_FILE")"
cat >"$work/cert.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $RAKESH_SIGNING_IDENTITY
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
p12pw="$(openssl rand -hex 16)"
openssl pkcs12 -export -legacy -name "$RAKESH_SIGNING_IDENTITY" \
  -inkey "$work/key.pem" -in "$work/cert.pem" -out "$work/signing.p12" -passout "pass:$p12pw"

security create-keychain -p "$pw" "$kc"
security set-keychain-settings "$kc"
security unlock-keychain -p "$pw" "$kc"
security import "$work/signing.p12" -k "$kc" -P "$p12pw" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pw" "$kc" >/dev/null
# codesign finds identities through the user keychain search list.
read -r -a current <<<"$(security list-keychains -d user | tr -d '"' | xargs)"
security list-keychains -d user -s "${current[@]}" "$kc"
echo "setup-signing.sh: created \"$RAKESH_SIGNING_IDENTITY\" in $kc"
