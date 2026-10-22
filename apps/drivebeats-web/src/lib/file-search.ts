import type { DriveFile } from "@/types";

const WHITESPACE_PATTERN = /\s+/;

export interface HighlightPart {
  isMatch: boolean;
  start: number;
  value: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getSearchTokens(query: string) {
  return [
    ...new Set(query.trim().toLocaleLowerCase().split(WHITESPACE_PATTERN)),
  ].filter(Boolean);
}

export type SearchTags = { title?: string; artist?: string; album?: string };
export type TagLookup = (file: DriveFile) => SearchTags | undefined;

export function matchedSearchFields(
  file: DriveFile,
  query: string,
  tags?: SearchTags,
) {
  const tokens = getSearchTokens(query);
  const fields = {
    filename: file.name,
    cached_title: tags?.title,
    cached_artist: tags?.artist,
    cached_album: tags?.album,
  };
  return Object.entries(fields)
    .filter(
      ([, value]) =>
        value &&
        tokens.some((token) => value.toLocaleLowerCase().includes(token)),
    )
    .map(([key]) => key);
}

export function matchesFileSearch(
  file: DriveFile,
  query: string,
  tags?: SearchTags,
) {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  const values = [file.name, tags?.title, tags?.artist, tags?.album]
    .filter(Boolean)
    .map((value) => value?.toLocaleLowerCase() ?? "");
  return tokens.every((token) => values.some((value) => value.includes(token)));
}

export function filterFilesBySearch(
  files: DriveFile[],
  query: string,
  lookup?: TagLookup,
) {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) {
    return files;
  }

  return files.filter((file) => matchesFileSearch(file, query, lookup?.(file)));
}

export function getHighlightedTextParts(
  text: string,
  query: string,
): HighlightPart[] {
  const tokens = getSearchTokens(query).toSorted((a, b) => b.length - a.length);
  if (tokens.length === 0) {
    return [{ isMatch: false, start: 0, value: text }];
  }

  const expression = new RegExp(
    `(${tokens.map((token) => escapeRegExp(token)).join("|")})`,
    "gi",
  );
  const parts: HighlightPart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(expression)) {
    const start = match.index ?? 0;
    const value = match[0];

    if (start > lastIndex) {
      parts.push({
        isMatch: false,
        start: lastIndex,
        value: text.slice(lastIndex, start),
      });
    }

    parts.push({ isMatch: true, start, value });
    lastIndex = start + value.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      isMatch: false,
      start: lastIndex,
      value: text.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ isMatch: false, start: 0, value: text }];
}
