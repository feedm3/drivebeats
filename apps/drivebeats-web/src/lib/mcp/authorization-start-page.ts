import { createHash } from "node:crypto";

// Read the URL from an escaped, readonly field; never interpolate request data
// into executable JavaScript. A response-specific CSP permits only this script.
const copyScript = `const button = document.getElementById("copy-link");
const field = document.getElementById("connection-link");
const status = document.getElementById("copy-status");
button.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = "Link copied. Paste it into Firefox to continue.";
  } catch {
    field.focus();
    field.select();
    status.textContent = "Select and copy the link, then paste it into Firefox.";
  }
});`;

const scriptHash = createHash("sha256").update(copyScript).digest("base64");
export const AUTHORIZATION_START_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'sha256-${scriptHash}'`,
  "style-src 'unsafe-inline'",
].join("; ");

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function renderMcpAuthorizationStartPage(
  authorizationUrl: string,
  googleUrl: string,
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Connect DriveBeats to ChatGPT</title>
<style>
:root{color-scheme:light dark;font-family:Arial,sans-serif;background:#fafafa;color:#171717}
*{box-sizing:border-box}body{margin:0}main{max-width:32rem;min-height:100svh;margin:auto;padding:3rem 1.25rem;display:flex;flex-direction:column;justify-content:center}
.brand{color:#2563eb;font-size:.875rem;font-weight:600;margin:0 0 .75rem}h1{font-size:1.5rem;line-height:1.25;letter-spacing:-.02em;margin:0 0 1rem}p{font-size:.875rem;line-height:1.6;margin:0 0 1.25rem;color:#525252}
a,button{min-height:44px;min-width:44px;padding:.75rem 1.25rem;font-size:.875rem;font-weight:600;border-radius:.5rem;text-align:center}a{display:flex;align-items:center;justify-content:center;background:#2563eb;color:white;text-decoration:none}button{background:transparent;border:1px solid #d4d4d4;color:inherit;cursor:pointer;align-self:flex-start}
a:focus-visible,button:focus-visible,textarea:focus-visible{outline:2px solid #2563eb;outline-offset:4px}.browser{border-top:1px solid #d4d4d4;margin-top:2rem;padding-top:1.5rem}h2{font-size:1rem;margin:0 0 .5rem}label{display:block;font-size:.875rem;font-weight:600;margin-bottom:.5rem}textarea{display:block;width:100%;min-height:88px;padding:.75rem;margin-bottom:.75rem;border:1px solid #d4d4d4;border-radius:.5rem;resize:vertical;font:12px/1.5 monospace;background:transparent;color:inherit}#copy-status{min-height:2.75rem;margin:.75rem 0 0}.privacy{margin:1.25rem 0 0;font-size:.75rem}
@media(prefers-color-scheme:dark){:root{background:#0a0a0a;color:#f5f5f5}p{color:#a3a3a3}.brand{color:#60a5fa}button,textarea,.browser{border-color:#404040}}
</style>
</head>
<body>
<main>
<p class="brand">DriveBeats</p>
<h1>Connect DriveBeats to ChatGPT</h1>
<p>Continue with Google to connect your DriveBeats account.</p>
<a id="continue-google" href="${escapeHtml(googleUrl)}" rel="noreferrer">Continue with Google</a>
<p class="privacy">Google Drive access stays read-only.</p>
<section class="browser" aria-labelledby="browser-heading">
<h2 id="browser-heading">Use Firefox?</h2>
<p>Copy this connection link and open it in Firefox, then continue there.</p>
<label for="connection-link">Connection link</label>
<textarea id="connection-link" readonly rows="3" spellcheck="false">${escapeHtml(authorizationUrl)}</textarea>
<button id="copy-link" type="button">Copy link</button>
<p id="copy-status" role="status" aria-live="polite"></p>
</section>
</main>
<script>${copyScript}</script>
</body>
</html>`;
}
