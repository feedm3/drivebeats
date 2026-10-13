# Target-client verification

Run against the exact release directory or ZIP, using the CLI bundled with the
desktop app to detect compatibility gaps that a portable JSON schema misses:

```sh
python3 plugins/drivebeats-preview/scripts/verify-plugin.py \
  --archive /absolute/path/drivebeats-preview.zip \
  --codex /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```

Use `--plugin /absolute/path/release` instead of `--archive` for a directory.
Add `--check-server` after deployment to require an anonymous handshake and all
seven tools. The default checks manifest loading and matching icon bytes only.
The script uses a temporary marketplace and isolated Codex state. It does not
use your credentials, run a model, start OAuth login, or change your installation.
Both credential stores use temporary files instead of the system keychain.
Passing these checks does not prove account linking or native icon rendering.
