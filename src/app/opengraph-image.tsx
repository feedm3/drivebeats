import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "Google Drive MP3 Player — Stream Your Music Collection Online for Free";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 80,
            height: 80,
            borderRadius: 20,
            background: "#2dd4a8",
            marginBottom: 24,
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0a0a0a"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            marginBottom: 16,
          }}
        >
          Google Drive MP3 Player
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
