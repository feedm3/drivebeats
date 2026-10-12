import { NextResponse } from "next/server";
import { batchUpsertTrackMetadata } from "@/db/track-metadata";
import { upsertUser } from "@/db/users";
import { getServerAuthSession } from "@/lib/server-auth";

export const runtime = "nodejs";

interface TrackMetadataInput {
  fileId: string;
  modifiedTime?: string;
  title?: string;
  artist?: string;
  album?: string;
}

function isValidString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { tracks?: unknown };
  try {
    body = (await request.json()) as { tracks?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
    return NextResponse.json(
      { error: "tracks must be a non-empty array" },
      { status: 400 },
    );
  }

  if (body.tracks.length > 50) {
    return NextResponse.json(
      { error: "Maximum 50 tracks per request" },
      { status: 400 },
    );
  }

  const records: TrackMetadataInput[] = [];
  for (const item of body.tracks) {
    if (!item || typeof item !== "object") {
      return NextResponse.json(
        { error: "Invalid track entry" },
        { status: 400 },
      );
    }

    const track = item as Record<string, unknown>;

    if (typeof track.fileId !== "string" || track.fileId.length === 0) {
      return NextResponse.json(
        { error: "Each track must have a fileId" },
        { status: 400 },
      );
    }

    if (track.title !== undefined && !isValidString(track.title, 500)) {
      return NextResponse.json(
        { error: "title must be a string of max 500 characters" },
        { status: 400 },
      );
    }

    if (track.artist !== undefined && !isValidString(track.artist, 500)) {
      return NextResponse.json(
        { error: "artist must be a string of max 500 characters" },
        { status: 400 },
      );
    }

    if (track.album !== undefined && !isValidString(track.album, 500)) {
      return NextResponse.json(
        { error: "album must be a string of max 500 characters" },
        { status: 400 },
      );
    }

    records.push({
      fileId: track.fileId as string,
      modifiedTime:
        typeof track.modifiedTime === "string" ? track.modifiedTime : undefined,
      title: track.title as string | undefined,
      artist: track.artist as string | undefined,
      album: track.album as string | undefined,
    });
  }

  await upsertUser(session.user);
  await batchUpsertTrackMetadata(session.user.id, records);

  return NextResponse.json({ ok: true });
}
