import { z } from "zod";
import { getMcpGrant } from "@/db/mcp-grants";
import { isSupportedAudioFile } from "@/lib/audio";
import type { AuthUser } from "@/lib/auth-session";
import { GOOGLE_APIS } from "@/lib/google-api";
import { getMcpGoogleAccessToken, type McpPrincipal } from "./auth";
import {
  consumeMcpMusicImport,
  getMcpMusicImport,
} from "./music-session-service";

const input = z.strictObject({
  fileIds: z
    .array(
      z
        .string()
        .min(1)
        .max(256)
        .regex(/^[\w-]+$/),
    )
    .min(1)
    .max(100),
});
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

export async function completeMcpImportSelection(
  request: Request,
  capability: string,
  user: AuthUser | null,
) {
  if (!user)
    return Response.json(
      { error: "Sign in to DriveBeats first." },
      { status: 401, headers },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Selection must be submitted from DriveBeats." },
      { status: 403, headers },
    );
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability))
    return Response.json(
      { error: "This import request has expired." },
      { status: 404, headers },
    );
  const reader = request.body?.getReader();
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16_384) {
          await reader.cancel();
          return Response.json(
            { error: "Too many selected items." },
            { status: 413, headers },
          );
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const parsed = input.safeParse(
    (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Select up to 100 folders or Playable Tracks." },
      { status: 400, headers },
    );
  try {
    const selection = await getMcpMusicImport(capability, user.id);
    const grant = await getMcpGrant(selection.grantId);
    if (
      !grant ||
      grant.googleUserId !== user.id ||
      grant.revokedAt ||
      grant.expiresAt.getTime() <= Date.now()
    )
      throw new Error("unavailable");
    const principal: McpPrincipal = {
      googleUserId: user.id,
      grantId: grant.id,
      profile: grant.profile,
      scopes: grant.scopes,
    };
    const token = await getMcpGoogleAccessToken(principal);
    const folderIds: string[] = [];
    const trackIds: string[] = [];
    const ids = [...new Set(parsed.data.fileIds)];
    for (let start = 0; start < ids.length; start += 5) {
      const batch = await Promise.all(
        ids.slice(start, start + 5).map(async (id) => {
          const url = new URL(
            `${GOOGLE_APIS.driveFilesUrl}/${encodeURIComponent(id)}`,
          );
          url.search = new URLSearchParams({
            fields: "id,name,mimeType,trashed",
            supportsAllDrives: "true",
          }).toString();
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error("unavailable");
          const item = (await response.json()) as {
            id?: string;
            name?: string;
            mimeType?: string;
            trashed?: boolean;
          };
          if (item.id !== id || !item.name || !item.mimeType || item.trashed)
            throw new Error("unavailable");
          return { id, name: item.name, mimeType: item.mimeType };
        }),
      );
      for (const item of batch) {
        if (item.mimeType === "application/vnd.google-apps.folder")
          folderIds.push(item.id);
        else if (isSupportedAudioFile(item)) trackIds.push(item.id);
        else
          return Response.json(
            { error: "Select folders or supported audio only." },
            { status: 422, headers },
          );
      }
    }
    await consumeMcpMusicImport(capability, user.id, {
      importedFolderIds: folderIds,
      standaloneTrackIds: trackIds,
    });
    return Response.json(
      { status: "imported", count: ids.length },
      { headers },
    );
  } catch {
    return Response.json(
      {
        error:
          "The selection is unavailable or expired. Return to DriveBeats in ChatGPT and start Import again.",
      },
      { status: 409, headers },
    );
  }
}
