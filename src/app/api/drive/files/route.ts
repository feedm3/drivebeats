import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const folderId = searchParams.get("folderId") || "root";
  const accessToken = searchParams.get("accessToken");

  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token" },
      { status: 401 },
    );
  }

  const query = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'audio/mpeg' or mimeType = 'audio/mp3')`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,size)",
    orderBy: "folder,name",
    pageSize: "1000",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  const data = await res.json();
  if (data.error) {
    return NextResponse.json(
      { error: data.error.message },
      { status: data.error.code },
    );
  }

  return NextResponse.json(data.files || []);
}
