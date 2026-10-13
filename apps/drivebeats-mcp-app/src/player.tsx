import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import logo from "../../drivebeats-web/public/web-app-manifest-192x192.png?inline";
import { AccountPanel } from "./account-panel";
import type { FixtureBridge } from "./fixture-bridge";
import { FIXTURE_TRACKS, type FixtureTrackId } from "./fixture-tracks";

interface PlayerProps {
  bridge: FixtureBridge;
  audioSources: Record<FixtureTrackId, string>;
  sourceError?: string;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function Player({ bridge, audioSources, sourceError }: PlayerProps) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [selectedId, setSelectedId] = useState<FixtureTrackId>("pulse");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playAttempt = useRef(0);
  const track =
    state.tracks.find((item) => item.id === selectedId) ?? FIXTURE_TRACKS[0];

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      playAttempt.current += 1;
      audio?.pause();
    };
  }, []);

  async function play() {
    const audio = audioRef.current;
    if (!audio || sourceError) return;
    const attempt = ++playAttempt.current;
    setPlaybackError(null);
    try {
      await audio.play();
    } catch {
      if (attempt !== playAttempt.current) return;
      setPlaying(false);
      setPlaybackError("Playback could not start. Tap Play to try again.");
    }
  }

  function pause() {
    playAttempt.current += 1;
    audioRef.current?.pause();
    setPlaying(false);
  }

  function select(id: FixtureTrackId) {
    if (id === selectedId) return;
    pause();
    setSelectedId(id);
    setPosition(0);
    setPlaybackError(null);
  }

  function next() {
    const index = FIXTURE_TRACKS.findIndex((item) => item.id === selectedId);
    select(FIXTURE_TRACKS[(index + 1) % FIXTURE_TRACKS.length].id);
  }

  async function refresh() {
    setRefreshNotice(null);
    if (await bridge.refresh()) setRefreshNotice("Tracks refreshed");
  }

  const error = sourceError ?? playbackError ?? state.error;
  const status = state.loading ? "Refreshing tracks…" : refreshNotice;

  return (
    <main className="player-shell">
      <header className="masthead">
        {/* biome-ignore lint/performance/noImgElement: Vite embeds the same static logo as the web header; no Next image service exists here. */}
        <img className="brand-logo" src={logo} alt="" width={36} height={36} />
        <h1>DriveBeats</h1>
      </header>

      {bridge.account ? <AccountPanel bridge={bridge.account} /> : null}

      <section className="now-playing" aria-label="Current track">
        <div className="sample-art" data-track={selectedId} aria-hidden="true">
          <span className="record">
            <span className="record-center" />
          </span>
        </div>
        <div className="track-copy">
          <p className="eyebrow">{playing ? "Now playing" : "Ready to play"}</p>
          <h2>{track.title}</h2>
          <p className="artist">{track.artist}</p>
          <p className="track-note">
            Sample track · {formatTime(track.durationSeconds)}
          </p>
        </div>
      </section>

      <div className="transport">
        <button
          className="play-button"
          type="button"
          onClick={() => void (playing ? pause() : play())}
          aria-label={playing ? "Pause" : "Play"}
          disabled={Boolean(sourceError)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
          >
            {playing ? (
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            ) : (
              <path d="M7 4v16l13-8z" />
            )}
          </svg>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          className="next-button"
          type="button"
          onClick={next}
          aria-label="Next track"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
          >
            <path d="M5 4v16l12-8zM18 4h3v16h-3z" />
          </svg>
          Next
        </button>
        <span
          className="time"
          role="timer"
          aria-label={`${formatTime(position)} of ${formatTime(track.durationSeconds)}`}
        >
          {formatTime(position)} / {formatTime(track.durationSeconds)}
        </span>
      </div>
      <progress
        className="progress"
        value={position}
        max={track.durationSeconds}
        aria-label="Track progress"
      />

      {/* A stable Audio element survives every tool result and track metadata update. */}
      {/* biome-ignore lint/a11y/useMediaCaption: Original instrumental samples contain no speech. */}
      <audio
        ref={audioRef}
        src={audioSources[selectedId] || undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => {
          setPlaying(false);
          setPlaybackError(
            "This sample could not load. Try another track or reopen DriveBeats.",
          );
        }}
      />

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="queue" aria-labelledby="queue-heading">
        <div className="section-heading">
          <h2 id="queue-heading">Sample tracks</h2>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void refresh()}
            disabled={state.loading || !state.canCallTools}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M20 7v5h-5M4 17v-5h5M5.4 7a7.5 7.5 0 0 1 12.5-2L20 8M4 16l2.1 3A7.5 7.5 0 0 0 18.6 17" />
            </svg>
            {state.loading ? "Refreshing…" : "Refresh tracks"}
          </button>
        </div>
        <ol className="track-list">
          {state.tracks.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="track-row"
                onClick={() => select(item.id)}
                aria-pressed={selectedId === item.id}
              >
                <span className="track-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="track-title">
                  {item.title}
                  <span>{item.artist}</span>
                </span>
                <span className="track-duration">
                  {formatTime(item.durationSeconds)}
                </span>
                <span className="selected-marker" aria-hidden="true">
                  {selectedId === item.id ? "●" : ""}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="refresh-status" role="status">
          {status}
        </p>
      </section>
      <p className="footer-note">Original samples by DriveBeats.</p>
    </main>
  );
}
