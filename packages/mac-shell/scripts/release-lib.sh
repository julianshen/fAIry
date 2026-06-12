#!/usr/bin/env bash
# Pure helpers shared by the release scripts and release.yml (M6-3).
# Sourced — defines functions only, no side effects.

# version_from_tag vX.Y.Z → X.Y.Z (a ref without the leading v passes through).
version_from_tag() { printf '%s\n' "${1#v}"; }

# appcast_extra_args — populate APPCAST_EXTRA_ARGS with the optional
# generate_appcast flags taken from the CI env seams. Both seams default to
# empty, which preserves the local-runbook behavior (EdDSA key from the
# keychain, local enclosure URLs).
appcast_extra_args() {
  APPCAST_EXTRA_ARGS=()
  if [ -n "${FAIRY_SPARKLE_PRIVATE_KEY_FILE:-}" ]; then
    APPCAST_EXTRA_ARGS+=(--ed-key-file "$FAIRY_SPARKLE_PRIVATE_KEY_FILE")
  fi
  if [ -n "${FAIRY_DOWNLOAD_URL_PREFIX:-}" ]; then
    APPCAST_EXTRA_ARGS+=(--download-url-prefix "$FAIRY_DOWNLOAD_URL_PREFIX")
  fi
}
