import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(!isProduction ? ["'unsafe-eval'"] : []),
  "https://apis.google.com",
  "https://va.vercel-scripts.com",
];

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src ${scriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://va.vercel-scripts.com",
  "frame-src 'self' https://docs.google.com https://drive.google.com",
  "media-src 'self' blob: https://www.googleapis.com",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // jsmediatags bundles a ReactNativeFileReader that requires react-native-fs.
      // We only use the browser Blob reader, so stub this out.
      "react-native-fs": "./src/lib/empty-module.js",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
