# Mac signing profile backup

Only encrypted signing material and public recipients belong here.
The profile backup is encrypted to the same SSH recipient used by the meta-repository's App Store credentials.
Its private identity stays outside this repository.
The profile is tied to its selected Developer ID certificate; regenerating either requires refreshing the encrypted backup and GitHub signing secrets with owner approval.

Restore outside the repository, use it, then remove the temporary directory:

```bash
profile_dir=$(mktemp -d)
trap 'rm -rf "$profile_dir"' EXIT
age --decrypt --identity ~/.ssh/id_ed25519 \
  --output "$profile_dir/profile.provisionprofile" \
  ios/App/signing/encrypted/MindRoom-Chat-Developer-ID.provisionprofile.age
export MACOS_PROVISIONING_PROFILE_PATH="$profile_dir/profile.provisionprofile"
# Set the signing/notarization environment with hidden input, then:
scripts/build-macos-app.sh --sign
```

Do not print decoded profile data or exported private keys into CI logs.
Repository automation reads `MACOS_PROVISIONING_PROFILE_BASE64`; it does not have the SSH decryption identity.
