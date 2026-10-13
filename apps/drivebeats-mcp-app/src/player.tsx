import type { CatalogEntry } from "@drivebeats/client/catalog";
import { filterFilesBySearch } from "@drivebeats/client/file-search";
import {
  BreadcrumbNav,
  FileRows,
  FolderTree,
  LibrarySearch,
} from "@drivebeats/client/views";
import {
  type DriveFile,
  FOLDER_MIME,
  type FolderEntry,
} from "@drivebeats/core/types";
import { useMemo, useState, useSyncExternalStore } from "react";
import logo from "../../drivebeats-web/public/web-app-manifest-192x192.png?inline";
import { AccountPanel } from "./account-panel";
import type { MusicBridge } from "./music-bridge";

function time(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
const EMPTY_CATALOG: CatalogEntry[] = [];
export function Player({ bridge }: { bridge: MusicBridge }) {
  const account = useSyncExternalStore(
    bridge.account.subscribe,
    bridge.account.getSnapshot,
  );
  return (
    <MusicView key={account.profile?.id ?? "signed_out"} bridge={bridge} />
  );
}
function MusicView({ bridge }: { bridge: MusicBridge }) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const account = useSyncExternalStore(
    bridge.account.subscribe,
    bridge.account.getSnapshot,
  );
  const playback = useSyncExternalStore(
    bridge.player.subscribe,
    bridge.player.getSnapshot,
  );
  const [folderStack, setFolderStack] = useState<FolderEntry[]>([
    { id: "root", name: "Library" },
  ]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"library" | "folder">("library");
  const [collection, setCollection] = useState("library");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [visible, setVisible] = useState(100);
  const currentFolder = folderStack[folderStack.length - 1]?.id ?? "root";
  const favorites = useMemo(
    () => new Set(state.favorites.map((track) => track.fileId)),
    [state.favorites],
  );
  const entries = state.catalog?.entries ?? EMPTY_CATALOG;
  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const files = useMemo(() => {
    if (collection !== "library") {
      const tracks =
        collection === "favorites"
          ? state.favorites
          : (state.playlists.find((playlist) => playlist.id === collection)
              ?.tracks ?? []);
      return filterFilesBySearch(
        tracks.map((track) => ({
          id: track.fileId,
          name: track.fileName,
          mimeType: track.mimeType ?? "audio/mpeg",
          parents: track.parents,
        })),
        query,
      );
    }
    const candidates =
      query.trim() && scope === "library"
        ? entries.filter((entry) => entry.mimeType !== FOLDER_MIME)
        : entries.filter((entry) => entry.parentId === currentFolder);
    return filterFilesBySearch(candidates, query);
  }, [
    collection,
    currentFolder,
    entries,
    query,
    scope,
    state.favorites,
    state.playlists,
  ]);
  const folders = useMemo(
    () =>
      entries
        .filter((entry) => entry.mimeType === FOLDER_MIME)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          depth: entry.path.split("/").length - 1,
        })),
    [entries],
  );
  function navigate(folder: FolderEntry) {
    const chain: FolderEntry[] = [];
    let item = entryById.get(folder.id);
    const seen = new Set<string>();
    while (item && !seen.has(item.id)) {
      seen.add(item.id);
      chain.unshift({ id: item.id, name: item.name });
      item = entryById.get(item.parentId);
    }
    setFolderStack([{ id: "root", name: "Library" }, ...chain]);
    setCollection("library");
    setQuery("");
    setVisible(100);
  }
  const connected = account.status === "connected";
  return (
    <main className="player-shell">
      <header className="masthead">
        {/* biome-ignore lint/performance/noImgElement: This Vite app embeds its static brand image. */}
        <img src={logo} alt="" width={36} height={36} />
        <h1>DriveBeats</h1>
      </header>
      <AccountPanel
        bridge={bridge.account}
        onRefresh={() => bridge.refresh()}
      />
      {connected ? (
        <>
          <section className="db-library" aria-labelledby="library-heading">
            <div className="section-heading">
              <h2 id="library-heading">Your Library</h2>
              <div className="account-actions">
                <button
                  type="button"
                  disabled={!state.sessionId}
                  onClick={() => void bridge.importMusic()}
                >
                  Import music
                </button>
                <button
                  type="button"
                  disabled={state.loading || !state.sessionId}
                  onClick={() => void bridge.refresh()}
                >
                  Refresh
                </button>
              </div>
            </div>
            <p className="muted">
              Select folders or tracks in Google Drive. Imported music stays on
              this device. Playlists and favorites sync with DriveBeats.
            </p>
            <nav aria-label="Music collections" className="collection-tabs">
              <button
                type="button"
                aria-pressed={collection === "library"}
                onClick={() => {
                  setCollection("library");
                  setVisible(100);
                }}
              >
                Library
              </button>
              <button
                type="button"
                aria-pressed={collection === "favorites"}
                onClick={() => {
                  setCollection("favorites");
                  setVisible(100);
                }}
              >
                Favorites
              </button>
              {state.playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  aria-pressed={collection === playlist.id}
                  onClick={() => {
                    setCollection(playlist.id);
                    setVisible(100);
                  }}
                >
                  {playlist.name}
                </button>
              ))}
            </nav>
            {collection === "library" ? (
              <>
                <FolderTree
                  folders={folders}
                  currentId={currentFolder}
                  onNavigate={navigate}
                />
                <BreadcrumbNav
                  folderStack={folderStack}
                  onNavigate={(index) => {
                    setFolderStack(folderStack.slice(0, index + 1));
                    setQuery("");
                    setVisible(100);
                  }}
                />
              </>
            ) : null}
            <LibrarySearch
              value={query}
              onChange={(value) => {
                setQuery(value);
                setVisible(100);
              }}
              scope={scope}
              onScopeChange={(value) => {
                setScope(value);
                setVisible(100);
              }}
            />
            {state.loading ? (
              <p role="status">Building your complete Library…</p>
            ) : null}
            <FileRows
              files={files.slice(0, visible)}
              query={query}
              currentId={playback.track?.id}
              favorites={favorites}
              metadata={state.trackMetadata}
              onFolder={navigate}
              onPlay={(file: DriveFile) =>
                void bridge.player.play(
                  file,
                  files.filter((entry) => entry.mimeType !== FOLDER_MIME),
                )
              }
              onFavorite={(file) => void bridge.favorite(file)}
            />
            {files.length > visible ? (
              <button
                type="button"
                onClick={() => setVisible((value) => value + 100)}
              >
                Show more tracks
              </button>
            ) : null}
            {!files.length && !state.loading ? (
              <p className="muted">
                {query
                  ? "No filenames match this search."
                  : "No tracks here yet. Import your music to start listening."}
              </p>
            ) : null}
          </section>
          <section className="now-playing" aria-labelledby="playing-heading">
            <p className="eyebrow">
              {playback.playing ? "Now playing" : "Ready to play"}
            </p>
            <h2 id="playing-heading">
              {playback.track
                ? (state.trackMetadata[playback.track.id]?.title ??
                  playback.track.name)
                : "Choose a Playable Track"}
            </h2>
            {playback.track && state.trackMetadata[playback.track.id] ? (
              <p className="muted">
                {[
                  state.trackMetadata[playback.track.id].artist,
                  state.trackMetadata[playback.track.id].album,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <div className="transport">
              <button
                type="button"
                aria-label="Previous track"
                disabled={!playback.track}
                onClick={() => void bridge.player.previous()}
              >
                Previous
              </button>
              <button
                className="play-button"
                type="button"
                disabled={!playback.track || playback.loading}
                onClick={() => void bridge.player.toggle()}
              >
                {playback.loading
                  ? "Loading…"
                  : playback.playing
                    ? "Pause"
                    : "Play"}
              </button>
              <button
                type="button"
                aria-label="Next track"
                disabled={!playback.queue.length}
                onClick={() => void bridge.player.next()}
              >
                Next
              </button>
            </div>
            <label className="range-label">
              <span>
                {time(playback.position)} / {time(playback.duration)}
              </span>
              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={playback.duration || 1}
                step={1}
                value={Math.min(playback.position, playback.duration || 1)}
                disabled={!playback.duration}
                onChange={(event) =>
                  bridge.player.seek(Number(event.target.value))
                }
              />
            </label>
            <div className="player-options">
              <button
                type="button"
                aria-pressed={playback.shuffle}
                onClick={() => bridge.player.setShuffle(!playback.shuffle)}
              >
                Shuffle
              </button>
              <label>
                Repeat
                <select
                  aria-label="Repeat"
                  value={playback.repeat}
                  onChange={(event) =>
                    bridge.player.setRepeat(
                      event.target.value as "off" | "all" | "one",
                    )
                  }
                >
                  <option value="off">Off</option>
                  <option value="all">All</option>
                  <option value="one">One</option>
                </select>
              </label>
              <label className="volume">
                Volume
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={playback.volume}
                  onChange={(event) =>
                    bridge.player.setVolume(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <p className="muted">
              Playback Queue · {playback.queue.length} tracks
            </p>
            {playback.error ? (
              <div className="error" role="alert" aria-label="Playback error">
                <p>{playback.error}</p>
                <button
                  type="button"
                  disabled={!state.sessionId}
                  onClick={() => void bridge.importMusic()}
                >
                  Import music
                </button>
              </div>
            ) : null}
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void bridge.saveQueue(name.trim());
              }}
            >
              <input
                aria-label="New Playlist name"
                placeholder="Playlist name"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                disabled={
                  !name.trim() ||
                  !playback.queue.length ||
                  playback.queue.length > 500
                }
              >
                Save queue as Playlist
              </button>
            </form>
          </section>
          <section className="dj-panel" aria-labelledby="dj-heading">
            <h2 id="dj-heading">DJ Mode</h2>
            <p className="muted">
              Let AI choose upcoming tracks from filenames in your Library.
              Manual playback choices stop DJ Mode.
            </p>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!state.dj) bridge.startDj(intent);
              }}
            >
              <input
                aria-label="Listening intent"
                placeholder="What do you want to hear?"
                maxLength={500}
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
              />
              <button
                type={state.dj ? "button" : "submit"}
                disabled={
                  !state.djSupported ||
                  !entries.some((entry) => entry.mimeType !== FOLDER_MIME)
                }
                onClick={
                  state.dj
                    ? (event) => {
                        event.preventDefault();
                        bridge.stopDj();
                      }
                    : undefined
                }
              >
                {state.dj ? "Stop DJ Mode" : "Start DJ Mode"}
              </button>
            </form>
            {!state.djSupported ? (
              <p className="muted">DJ Mode is unavailable here.</p>
            ) : null}
            {state.djNotice ? <p role="status">{state.djNotice}</p> : null}
          </section>
        </>
      ) : null}
      {state.notice ? <p role="status">{state.notice}</p> : null}
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
    </main>
  );
}
