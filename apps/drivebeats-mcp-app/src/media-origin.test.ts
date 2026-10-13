import { afterEach, expect, it } from "vitest";
import { getMcpMediaOrigin, MEDIA_CONFIG_ID } from "./media-origin";

afterEach(() => document.body.replaceChildren());
function config(value: unknown) {
  const script = document.createElement("script");
  script.id = MEDIA_CONFIG_ID;
  script.type = "application/json";
  script.textContent = JSON.stringify(value);
  document.body.append(script);
}
it("reads a separate canonical HTTPS issuer and keeps missing or disabled media unavailable", () => {
  expect(getMcpMediaOrigin()).toBeNull();
  config({ origin: null });
  expect(getMcpMediaOrigin()).toBeNull();
  document.body.replaceChildren();
  config({ origin: "https://drivebeats.example" });
  expect(getMcpMediaOrigin()).toBe("https://drivebeats.example");
});
it.each([
  "http://drivebeats.example",
  "https://drivebeats.example/path",
  "https://drivebeats.example/",
  "https://user:password@drivebeats.example",
])("rejects noncanonical media origin %s", (origin) => {
  config({ origin });
  expect(() => getMcpMediaOrigin()).toThrow();
});
it("rejects unexpected fields and elements rather than taking a tool-supplied origin", () => {
  config({ origin: "https://drivebeats.example", token: "private" });
  expect(() => getMcpMediaOrigin()).toThrow();
  document.body.innerHTML = `<div id="${MEDIA_CONFIG_ID}">{"origin":"https://drivebeats.example"}</div>`;
  expect(() => getMcpMediaOrigin()).toThrow();
});
