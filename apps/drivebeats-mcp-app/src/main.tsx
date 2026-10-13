import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { createMusicBridge } from "./music-bridge";
import { Player } from "./player";
import "@drivebeats/client/styles.css";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("DriveBeats root element is missing.");
const app =
  window.parent === window
    ? null
    : new App(
        { name: "DriveBeats", version: "0.1.0" },
        {},
        { strict: true, autoResize: false },
      );
const audio = document.createElement("audio");
audio.preload = "metadata";
audio.hidden = true;
document.body.append(audio);
const bridge = createMusicBridge(app, audio);
const root = createRoot(element);
let tornDown = false;
async function teardown(closeTransport = true) {
  if (tornDown) return;
  tornDown = true;
  root.unmount();
  audio.remove();
  await bridge.dispose(closeTransport);
}
if (app)
  app.onteardown = async () => {
    await teardown(false);
    return {};
  };
window.addEventListener("pagehide", (event) => {
  bridge.suspend();
  if (!event.persisted) void teardown();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void bridge.refresh();
});
root.render(<Player bridge={bridge} />);
void bridge.connect();
