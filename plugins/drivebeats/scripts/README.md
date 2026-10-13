# Target-client verification

Verify the exact compatibility release archive with the desktop's bundled CLI:

```sh
python3 plugins/drivebeats/scripts/verify-plugin.py \
  --archive /absolute/path/drivebeats-1.0.0.zip \
  --codex /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```

The archive includes `.codex-plugin/plugin.json`, `.mcp.json` and packaged PNG
assets; portable manifest references are excluded. Use `--plugin` for a prepared
compatibility-only directory. `--check-server` additionally requires the exact
production tool inventory after deployment. Default checks cover manifest,
server configuration, icon bytes and the actual desktop loader.

All state is temporary and isolated. The script does not use user credentials,
run a model, start OAuth login or modify the installed plugin. Passing the
checks does not prove real account linking, audible playback or host sampling.
