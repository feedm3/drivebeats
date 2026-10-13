import { useSyncExternalStore } from "react";
import type { AccountBridge } from "./account-bridge";

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function AccountPanel({
  bridge,
  onRefresh,
}: {
  bridge: AccountBridge;
  onRefresh?: () => Promise<void>;
}) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const connected = state.status === "connected" && state.profile;
  const disabled = state.loading || !state.available;
  return (
    <section className="account-panel" aria-labelledby="account-heading">
      <div className="section-heading">
        <h2 id="account-heading">Your DriveBeats account</h2>
        {connected ? <span className="account-badge">Connected</span> : null}
      </div>
      {connected ? (
        <>
          <p className="account-name">
            {state.profile?.name ||
              state.profile?.email ||
              "DriveBeats account"}
          </p>
          {state.profile?.name && state.profile.email ? (
            <p className="account-detail">{state.profile.email}</p>
          ) : null}
          {state.library ? (
            <>
              <p className="account-detail">
                {countLabel(state.library.playlists.length, "Playlist")} ·{" "}
                {countLabel(state.library.favoriteCount, "favorite")}
              </p>
              {state.library.playlists.length ? (
                <ul className="saved-playlists" aria-label="Saved Playlists">
                  {state.library.playlists.map((playlist) => (
                    <li key={playlist.id}>
                      <span>{playlist.name}</span>
                      <span className="account-detail">
                        {countLabel(playlist.trackCount, "track")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="account-detail">No saved Playlists yet.</p>
              )}
            </>
          ) : (
            <p className="account-detail">Refresh to load your saved music.</p>
          )}
          <div className="account-actions">
            <button
              className="next-button"
              type="button"
              disabled={disabled}
              onClick={() => void (onRefresh ? onRefresh() : bridge.refresh())}
            >
              Refresh saved music
            </button>
            <button
              className="refresh-button"
              type="button"
              disabled={disabled}
              onClick={() => void bridge.disconnect()}
            >
              Disconnect
            </button>
          </div>
          <p className="footer-note">
            Disconnect keeps your saved Playlists and favorites.
          </p>
        </>
      ) : (
        <>
          <p className="account-detail">
            Connect the Google account you use with DriveBeats to see your saved
            Playlists and favorites here.
          </p>
          <button
            className="play-button account-connect"
            type="button"
            disabled={disabled}
            onClick={() => void bridge.connect()}
          >
            {state.status === "signed_out"
              ? "Connect DriveBeats"
              : "Retry connection"}
          </button>
          {state.available ? (
            <p className="footer-note">
              On the connection page, you can copy the link to open it in
              Firefox.
            </p>
          ) : (
            <p className="footer-note">
              Open DriveBeats in ChatGPT to connect your account.
            </p>
          )}
        </>
      )}
      {state.error ? (
        <p className="error account-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.loading || state.notice ? (
        <p className="refresh-status" role="status">
          {state.loading ? "Updating your account…" : state.notice}
        </p>
      ) : null}
    </section>
  );
}
