interface TrackMetadata {
  title: string;
  subtitle?: string;
}

/** Replace underscores with spaces and collapse runs of whitespace. */
function humanize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseTrackMetadata(
  fileName: string,
  parentFolderName?: string,
): TrackMetadata {
  // Strip extension
  const stripped = fileName.replace(/\.(mp3|flac|wav|m4a|aac|ogg)$/i, "");

  // Strip leading track numbers (1-3 digits followed by separator)
  const cleaned = stripped.replace(/^\d{1,3}[\s.-]+/, "");

  // Guard: if stripping left an empty string, use the extension-stripped name
  const base = cleaned || stripped;

  // Split on " - " (space-dash-space) for Artist - Title pattern
  const spacedDash = base.indexOf(" - ");
  if (spacedDash !== -1) {
    const artist = humanize(base.slice(0, spacedDash));
    const title = humanize(base.slice(spacedDash + 3));
    if (artist && title) {
      return { title, subtitle: artist };
    }
  }

  // Scene-release style: underscores in the name + single-dash separator
  // e.g. "porter_robinson-100__in_the_bitch_original_mix"
  if (base.includes("_")) {
    const dashIdx = base.indexOf("-");
    if (dashIdx > 0) {
      const artist = humanize(base.slice(0, dashIdx));
      const title = humanize(base.slice(dashIdx + 1));
      if (artist && title) {
        return { title, subtitle: artist };
      }
    }
  }

  // No artist-title split: use parentFolderName as subtitle fallback
  return {
    title: humanize(base),
    subtitle: parentFolderName ? humanize(parentFolderName) : undefined,
  };
}
