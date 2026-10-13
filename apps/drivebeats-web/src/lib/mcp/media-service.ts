import { createHash, randomBytes } from "node:crypto";
import { getMcpGrant } from "@/db/mcp-grants";
import { getMcpMediaGrant, insertMcpMediaGrant } from "@/db/mcp-media-grants";
import { inferAudioMimeType, isSupportedAudioFile } from "@/lib/audio";
import { getCloudLibrarySyncPayload } from "@/lib/cloud-library-service";
import { GOOGLE_APIS } from "@/lib/google-api";
import {
  getMcpAuthConfig,
  getMcpGoogleAccessToken,
  McpAuthError,
  type McpPrincipal,
} from "./auth";

export class McpMediaError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const hashCapability = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const MEDIA_LIFETIME_MS = 5 * 60 * 1000;

async function selectedTrack(principal: McpPrincipal, fileId: string) {
  const library = await getCloudLibrarySyncPayload(principal.profile);
  const track = [
    ...library.favorites,
    ...library.playlists.flatMap((playlist) => playlist.tracks),
  ].find((track) => track.fileId === fileId);
  if (!track)
    throw new McpMediaError(
      404,
      "Select a Playable Track from your synced Playlists or favorites.",
    );
  return track;
}

export async function prepareMcpMedia(principal: McpPrincipal, fileId: string) {
  if (!principal.scopes.includes("media:read"))
    throw new McpAuthError("insufficient_scope", 403);
  if (principal.profile.id !== principal.googleUserId)
    throw new McpAuthError("invalid_token", 401);
  const track = await selectedTrack(principal, fileId);
  const accessToken = await getMcpGoogleAccessToken(principal);
  const metadataUrl = new URL(
    `${GOOGLE_APIS.driveFilesUrl}/${encodeURIComponent(fileId)}`,
  );
  metadataUrl.search = new URLSearchParams({
    fields: "id,name,mimeType,trashed",
    supportsAllDrives: "true",
  }).toString();
  const response = await fetch(metadataUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new McpMediaError(
      404,
      "This Playable Track is unavailable. Reconnect or select an accessible track.",
    );
  const metadata = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    trashed?: boolean;
  };
  if (
    metadata.id !== fileId ||
    metadata.trashed ||
    !metadata.name ||
    !isSupportedAudioFile({
      name: metadata.name,
      mimeType: metadata.mimeType ?? "",
    })
  ) {
    throw new McpMediaError(
      422,
      "This selected item is not a supported Playable Track.",
    );
  }
  const mimeType = inferAudioMimeType(metadata.name) ?? metadata.mimeType;
  if (!mimeType)
    throw new McpMediaError(
      422,
      "This selected item is not a supported Playable Track.",
    );
  const capability = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MEDIA_LIFETIME_MS);
  await insertMcpMediaGrant({
    capabilityHash: hashCapability(capability),
    grantId: principal.grantId,
    googleUserId: principal.googleUserId,
    fileId,
    mimeType,
    expiresAt,
  });
  return {
    fileId,
    fileName: track.fileName,
    mimeType,
    expiresAt: expiresAt.toISOString(),
    mediaUrl: `${getMcpAuthConfig().issuer}/api/mcp/media/${capability}`,
  };
}

export async function readMcpMedia(request: Request, capability: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability))
    throw new McpMediaError(
      404,
      "Media authorization expired. Select Play again.",
    );
  const media = await getMcpMediaGrant(hashCapability(capability));
  if (!media || media.expiresAt.getTime() <= Date.now())
    throw new McpMediaError(
      404,
      "Media authorization expired. Select Play again.",
    );
  const grant = await getMcpGrant(media.grantId);
  if (
    !grant ||
    grant.revokedAt ||
    new Date(grant.expiresAt).getTime() <= Date.now() ||
    grant.googleUserId !== media.googleUserId ||
    grant.profile.id !== media.googleUserId ||
    !grant.scopes.includes("media:read")
  ) {
    throw new McpMediaError(401, "Reconnect DriveBeats to play this track.");
  }
  const principal: McpPrincipal = {
    googleUserId: grant.googleUserId,
    grantId: grant.id,
    profile: grant.profile,
    scopes: grant.scopes,
  };
  await selectedTrack(principal, media.fileId);
  const range = request.headers.get("range");
  if (range && !/^bytes=(\d+-\d*|-\d+)$/.test(range))
    throw new McpMediaError(416, "Unsupported media range.");
  const accessToken = await getMcpGoogleAccessToken(principal);
  const url = new URL(
    `${GOOGLE_APIS.driveFilesUrl}/${encodeURIComponent(media.fileId)}`,
  );
  url.search = new URLSearchParams({
    alt: "media",
    supportsAllDrives: "true",
  }).toString();
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(range ? { Range: range } : {}),
    },
    signal: request.signal,
    cache: "no-store",
    redirect: "error",
  });
  if (upstream.status === 416)
    throw new McpMediaError(416, "Media range is unavailable.");
  if (upstream.status !== 200 && upstream.status !== 206)
    throw new McpMediaError(
      404,
      "This Playable Track is no longer accessible.",
    );
  const headers = new Headers({
    "Content-Type": media.mimeType,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function handleMcpMediaRequest(
  request: Request,
  capability: string,
) {
  try {
    return await readMcpMedia(request, capability);
  } catch (error) {
    const known = error instanceof McpMediaError;
    return Response.json(
      {
        error: known
          ? error.message
          : "Reconnect DriveBeats and select Play again.",
      },
      {
        status: known ? error.status : 503,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }
}
