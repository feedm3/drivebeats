#!/usr/bin/env python3
"""Check a release with the target Codex loader, without using the user's state.

Examples:
  python3 verify-plugin.py --plugin /path/to/release --codex /path/to/codex
  python3 verify-plugin.py --archive /path/to/release.zip --check-server

Only public plugin CLI and app-server methods are used. No model, OAuth login,
or user credentials are needed. --check-server additionally contacts the MCP
endpoint anonymously and requires all seven DriveBeats tools to load.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import zipfile


EXPECTED_TOOLS = {
    "drivebeats_open_fixture_player",
    "drivebeats_list_fixture_tracks",
    "drivebeats_get_profile",
    "drivebeats_connect_account",
    "drivebeats_get_cloud_library",
    "drivebeats_prepare_media",
    "drivebeats_disconnect",
}


class VerificationError(Exception):
    pass


def read_json(path):
    return json.loads(path.read_text())


def contained_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise VerificationError(f"Path escapes the package: {relative}")
    return path


def extract_archive(archive, destination):
    total_bytes = 0
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = contained_path(destination, entry.filename)
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise VerificationError(f"Archive contains a symlink: {entry.filename}")
            total_bytes += entry.file_size
            if total_bytes > 20 * 1024 * 1024:
                raise VerificationError("Plugin archive exceeds 20 MiB")
            if entry.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(bundle.read(entry))
    candidates = [destination, *[
        p for p in destination.iterdir() if p.is_dir() and not p.name.startswith(".")
    ]]
    roots = [
        p for p in candidates
        if (p / "plugin.json").is_file() or (p / ".codex-plugin/plugin.json").is_file()
    ]
    if len(roots) != 1:
        raise VerificationError("Archive must contain exactly one plugin root")
    return roots[0]


def copy_package(source, destination):
    # The release must be self-contained; silently following links would test
    # files that the archive or installed cache does not actually contain.
    for path in source.rglob("*"):
        if path.is_symlink():
            raise VerificationError(f"Package contains a symlink: {path.relative_to(source)}")
    shutil.copytree(source, destination)


def run_cli(binary, env, cwd, arguments):
    result = subprocess.run(
        [binary, *arguments], cwd=cwd, env=env, capture_output=True,
        text=True, timeout=25, check=False,
    )
    if result.returncode:
        raise VerificationError(f"Codex {' '.join(arguments[:2])} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


class PublicAppServer:
    def __init__(self, binary, env, cwd):
        self.output = queue.Queue()
        self.logs = []
        self.next_id = 0
        self.process = subprocess.Popen(
            [binary, "app-server", "--stdio"], cwd=cwd, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )
        threading.Thread(target=self.read_output, daemon=True).start()
        threading.Thread(target=self.read_logs, daemon=True).start()

    def read_output(self):
        for line in self.process.stdout:
            self.output.put(json.loads(line))

    def read_logs(self):
        for line in self.process.stderr:
            self.logs.append(line)

    def request(self, method, params, timeout=35):
        self.next_id += 1
        request_id = self.next_id
        self.process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                response = self.output.get(timeout=min(1, deadline - time.monotonic()))
            except queue.Empty:
                continue
            if response.get("id") != request_id:
                continue
            if "error" in response:
                raise VerificationError(f"{method}: {response['error']['message']}")
            return response["result"]
        raise VerificationError(f"{method} timed out")

    def initialize(self):
        self.request("initialize", {
            "clientInfo": {"name": "drivebeats-plugin-verification", "version": "1.0"},
            "capabilities": {"experimentalApi": True},
        })
        self.process.stdin.write('{"method":"initialized"}\n')
        self.process.stdin.flush()

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)

    def parser_errors(self):
        return [line.strip() for line in self.logs if "failed to parse plugin MCP" in line]


def verify(binary, source, work, check_server):
    market = work / "market"
    package = market / "plugins/drivebeats-fixture-player"
    copy_package(source, package)
    portable = package / "plugin.json"
    manifest = read_json(portable if portable.exists() else package / ".codex-plugin/plugin.json")
    name = manifest["name"]
    if name != "drivebeats-fixture-player":
        raise VerificationError(f"Unexpected plugin name: {name}")
    presentation = (
        manifest.get("extensions", {}).get("com.openai", {}).get("interface", {})
        if portable.exists() else manifest.get("interface", {})
    )
    expected_icons = {}
    for field in ["logo", "composerIcon"]:
        relative = presentation.get(field)
        if not relative:
            raise VerificationError(f"Manifest is missing {field}")
        asset = contained_path(package, relative)
        if not asset.is_file():
            raise VerificationError(f"Missing {field} asset: {relative}")
        expected_icons[field] = hashlib.sha256(asset.read_bytes()).hexdigest()

    mcp_path = package / "mcp.json" if portable.exists() else contained_path(package, manifest.get("mcpServers", "./.mcp.json"))
    mcp = read_json(mcp_path)
    if set(mcp.get("mcpServers", {})) != {"drivebeats"}:
        raise VerificationError("Release must declare exactly the DriveBeats MCP server")
    transport = mcp["mcpServers"]["drivebeats"]
    if transport.get("type") not in {"http", "streamable-http"}:
        raise VerificationError("Verification only supports remote HTTP MCP servers")

    marketplace_file = market / ".agents/plugins/marketplace.json"
    marketplace_file.parent.mkdir(parents=True)
    marketplace_file.write_text(json.dumps({
        "name": "drivebeats-release-check",
        "plugins": [{"name": name, "source": {"source": "local", "path": "./plugins/drivebeats-fixture-player"}}],
    }))
    codex_state = work / "codex-state"
    codex_state.mkdir()
    # Deliberately omit the user's environment, auth files and Codex config.
    env = {key: os.environ[key] for key in ["PATH", "LANG", "TMPDIR"] if key in os.environ}
    env.update({"CODEX_HOME": str(codex_state), "RUST_LOG": "codex_core_plugins=warn"})
    run_cli(binary, env, market, ["plugin", "marketplace", "add", str(market), "--json"])
    installed = run_cli(binary, env, market, ["plugin", "add", f"{name}@drivebeats-release-check", "--json"])
    server = PublicAppServer(binary, env, market)
    try:
        server.initialize()
        plugin = server.request("plugin/read", {"marketplacePath": str(marketplace_file), "pluginName": name})["plugin"]
        if plugin["mcpServers"] != ["drivebeats"]:
            details = "\n".join(server.parser_errors()) or "The loader returned no DriveBeats MCP server"
            raise VerificationError(details)
        interface = plugin["summary"]["interface"]
        for field, expected_digest in expected_icons.items():
            asset = Path(interface.get(field) or "")
            if not asset.is_absolute() or not asset.is_file() or not asset.resolve().is_relative_to(package.resolve()):
                raise VerificationError(f"Loader did not resolve {field} to the packaged asset")
            if hashlib.sha256(asset.read_bytes()).hexdigest() != expected_digest:
                raise VerificationError(f"Loaded {field} bytes differ from the release")
        # The installed copy is the runtime input, not the marketplace source.
        installed_path = Path(installed["installedPath"])
        for field in expected_icons:
            relative = presentation[field]
            if hashlib.sha256(contained_path(installed_path, relative).read_bytes()).hexdigest() != expected_icons[field]:
                raise VerificationError(f"Installed {field} bytes differ from the release")
        print(f"PASS: target loader discovers DriveBeats; logo and composerIcon resolve to matching packaged bytes ({manifest['version']})")
        if check_server:
            statuses = server.request("mcpServerStatus/list", {"serverName": "drivebeats", "detail": "full", "limit": 10})["data"]
            if len(statuses) != 1:
                raise VerificationError("Expected one installed DriveBeats server status")
            status = statuses[0]
            if status.get("toolsError"):
                raise VerificationError(status["toolsError"])
            tools = set(status.get("tools", {}))
            if tools != EXPECTED_TOOLS:
                raise VerificationError(f"Expected seven DriveBeats tools, received: {sorted(tools)}")
            print("PASS: anonymous target-client handshake and all seven deployed tools load")
    finally:
        server.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--plugin", type=Path, help="Self-contained plugin directory")
    inputs.add_argument("--archive", type=Path, help="ZIP release archive, including hidden files")
    parser.add_argument("--codex", default=shutil.which("codex"), help="Target Codex CLI binary; defaults to PATH")
    parser.add_argument("--check-server", action="store_true", help="Also connect anonymously to the packaged remote MCP endpoint")
    args = parser.parse_args()
    if not args.codex:
        parser.error("Pass --codex or install a Codex CLI on PATH")
    try:
        with tempfile.TemporaryDirectory(prefix="drivebeats-release-check-") as temporary:
            work = Path(temporary)
            if args.archive:
                destination = work / "archive"
                destination.mkdir()
                source = extract_archive(args.archive.resolve(), destination)
            else:
                source = args.plugin.resolve()
            verify(args.codex, source, work, args.check_server)
    except (VerificationError, OSError, ValueError, KeyError, subprocess.TimeoutExpired, zipfile.BadZipFile) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
