# Vercel access

Follow the project restriction and approval boundaries in [AGENTS.md](../AGENTS.md).

## CLI and credentials

`mise.local.toml` (gitignored, local-only) supplies `VERCEL_TOKEN` for the
private Vercel team. Agent shells do not activate mise automatically. Run from
this repository root with the helper below; no global Vercel installation or
browser login is needed. Keep the token in the environment, never in output or
command arguments.

```bash
vc() {
  MISE_CACHE_DIR="$PWD/.vercel/agent-cache/mise" \
  XDG_CACHE_HOME="$PWD/.vercel/agent-cache/xdg" \
  PNPM_HOME="$PWD/.vercel/agent-cache/pnpm" \
  NO_UPDATE_NOTIFIER=1 VERCEL_TELEMETRY_DISABLED=1 \
    mise exec -- pnpm dlx vercel@62.2.0 \
      --scope fabian-dietenbergers-projects \
      --global-config "$PWD/.vercel/agent-cache/config" \
      --non-interactive "$@"
}
```

The pinned CLI runs on demand; its cache/config files stay under the ignored
`.vercel/` directory. A bare `mise exec -- vercel` currently fails because the
global shim has no configured CLI. Mise loads credentials from its working
directory; Vercel's `--cwd` does not change that.

## Confirm the project

Before other project-aware commands, confirm `.vercel/project.json` names
`drivebeats`, then check the resolved project:

```bash
jq -e '.projectName == "drivebeats"' .vercel/project.json
vc project inspect
```

Proceed only when the resolved name is `drivebeats` and its owner is
`fabian-dietenbergers-projects` (displayed as `Fabian Dietenberger's projects`).
If credentials or linkage are missing, or the resolved target differs, report
the blocker. Linking and login follow-ups require the user's direction.

## Inspect deployments and logs

Use explicit project names and bounded queries. For production:

```bash
set -o pipefail
vc ls drivebeats --environment production --limit 2 --json |
  jq '.deployments[] | {url, state, target}'
```

For a branch investigation, use `--meta githubCommitRef=<branch>` instead of
the production filter, or combine the filters when both are relevant. A branch
filter alone does not establish the deployment environment.

Set `deployment_url` to the relevant URL from the list result, then inspect it:

```bash
vc inspect "$deployment_url"
(set -o pipefail; vc inspect "$deployment_url" --logs 2>&1 | tail -n 80)
vc logs "$deployment_url" --since 30m --limit 30
```

Build logs use stderr, so merge streams before limiting output. Runtime logs
need no `--follow`; narrow the time window or query before increasing limits.
Parse only stdout for JSON and deployment URLs.

A production-target deployment may have been superseded. When identifying the
deployment serving users, also inspect the production alias, such as
`vc inspect www.drivebeats.app`. A `READY` deployment proves build completion,
not runtime health or a working user flow; verify the affected flow separately.

## Inspect environment configuration

```bash
vc env ls
```

Use this listing for variable names, types, and environment scopes. The CLI may
also display abbreviated encrypted values; presence checks need no decrypted
values. `env pull` exports secrets into a local file rather than changing remote
configuration, so it falls under AGENTS.md's approval requirement for local
secret exports.
