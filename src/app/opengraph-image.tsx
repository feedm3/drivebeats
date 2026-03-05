import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "DriveBeats — Stream Your Music Collection from Google Drive";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const iconData = await readFile(
    join(process.cwd(), "public", "web-app-manifest-192x192.png"),
  );
  const iconBase64 = `data:image/png;base64,${iconData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          color: "white",
        }}
      >
        <img
          src={iconBase64}
          width={96}
          height={96}
          style={{ marginBottom: 24, borderRadius: 20 }}
        />
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            marginBottom: 16,
          }}
        >
          DriveBeats
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#a1a1aa",
            maxWidth: 600,
            textAlign: "center",
          }}
        >
          Stream your music collection online for free
        </div>
        <div
          style={{
            fontSize: 18,
            color: "#71717a",
            marginTop: 12,
          }}
        >
          Stream your music — no downloads, no uploads
        </div>
      </div>
    ),
    { ...size },
  );
}
