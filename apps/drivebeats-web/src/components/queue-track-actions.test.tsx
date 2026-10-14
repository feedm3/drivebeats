import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueueTrackActions } from "@/components/queue-track-actions";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { usePlayerStore } from "@/stores/player-store";
import type { DriveFile } from "@/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const current: DriveFile = {
  id: "current",
  name: "Current.mp3",
  mimeType: "audio/mpeg",
};
const track: DriveFile = {
  id: "next",
  name: "Next.mp3",
  mimeType: "audio/mpeg",
};
const initialPlayer = usePlayerStore.getState();

beforeEach(() => {
  usePlayerStore.setState({
    ...initialPlayer,
    currentTrack: current,
    playlist: [current],
    currentIndex: 0,
    queuedTracks: [],
  });
});
afterEach(cleanup);

describe("track queue actions", () => {
  it("queues a track from a clickable row without playing the row", async () => {
    const activateRow = vi.fn();
    render(
      <Table>
        <TableBody>
          <TableRow
            onClick={activateRow}
            onKeyDown={activateRow}
            role="button"
            tabIndex={0}
          >
            <TableCell>
              <QueueTrackActions
                track={track}
                folderStack={[{ id: "folder", name: "Music" }]}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const trigger = screen.getByRole("button", { name: "Queue Next.mp3" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);
    const playNext = await screen.findByRole("button", { name: "Play next" });
    fireEvent.click(playNext);

    expect(activateRow).not.toHaveBeenCalled();
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: current,
      queuedTracks: [{ track, folderStack: [{ id: "folder", name: "Music" }] }],
    });
  });
});
