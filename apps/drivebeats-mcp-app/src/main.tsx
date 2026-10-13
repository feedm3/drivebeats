import { createRoot } from "react-dom/client";
import { getFixtureAudioSources } from "./audio-sources";
import { initializeFixtureBridge } from "./fixture-bridge";
import { Player } from "./player";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("DriveBeats root element is missing.");
let sourceError: string | undefined;
let audioSources: ReturnType<typeof getFixtureAudioSources>;
try {
  audioSources = getFixtureAudioSources();
} catch {
  sourceError =
    "The sample tracks are unavailable. Reopen DriveBeats to reload them.";
  audioSources = { pulse: "", afterglow: "" };
}
const root = createRoot(rootElement);
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  root.unmount();
}
const bridge = initializeFixtureBridge(teardown, () =>
  rootElement.querySelector("audio")?.pause(),
);
root.render(
  <Player
    bridge={bridge}
    audioSources={audioSources}
    sourceError={sourceError}
  />,
);
