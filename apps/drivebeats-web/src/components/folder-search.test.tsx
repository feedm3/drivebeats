import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderSearch } from "@/components/folder-search";

vi.mock("@/components/ui/icon-tooltip", () => ({
  IconTooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Files search control", () => {
  afterEach(cleanup);

  it("defaults to a cached-metadata Library Search with a two-character hint", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value=""
      />,
    );

    expect(screen.getByLabelText("Search Library")).toBeEnabled();
    expect(screen.getByRole("option", { name: "Library" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Current folder" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Search file names and music details saved on this device/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enter at least two characters/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search information" }),
    ).toBeInTheDocument();
  });

  it("keeps the field visible but disabled with an accessible offline reason", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder={false}
        disabled
        disabledReason="Search requires an internet connection."
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value="old query"
      />,
    );

    expect(screen.getByLabelText("Search Library")).toBeDisabled();
    expect(
      screen.getByText("Search requires an internet connection."),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByRole("option", { name: "Current folder" }),
    ).not.toBeInTheDocument();
  });

  it("supports slash focus and Escape clearing", () => {
    const onChange = vi.fn();
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={onChange}
        onScopeChange={vi.fn()}
        scope="folder"
        value="live"
      />,
    );

    const input = screen.getByLabelText("Search Current Folder");
    fireEvent.keyDown(document, { key: "/" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("preserves focus on another control when search comes back online", () => {
    const control = (disabled: boolean) => (
      <>
        <button type="button">Other action</button>
        <FolderSearch
          id="file-search"
          open
          onOpenChange={vi.fn()}
          canSearchCurrentFolder
          disabled={disabled}
          onChange={vi.fn()}
          onScopeChange={vi.fn()}
          scope="library"
          value="live"
        />
      </>
    );
    const { rerender } = render(control(false));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    rerender(control(true));
    const otherAction = screen.getByRole("button", { name: "Other action" });
    otherAction.focus();

    rerender(control(false));

    expect(screen.getByRole("searchbox")).toBeEnabled();
    expect(otherAction).toHaveFocus();
  });

  it("clips native controls to the compound search border", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value=""
      />,
    );

    expect(
      screen.getByRole("searchbox").parentElement?.parentElement,
    ).toHaveClass("overflow-hidden");
  });

  it("uses matching separator spacing for the scope and search icons", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value=""
      />,
    );

    const scope = screen.getByRole("combobox", { name: "Search scope" });
    const scopeIcon = scope.nextElementSibling;
    const searchIcon =
      scope.parentElement?.nextElementSibling?.firstElementChild;

    expect(scopeIcon).toHaveClass("right-3");
    expect(searchIcon).toHaveClass("ml-3");
  });

  it("stacks the scope above a usable input row on narrow screens", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value="query"
      />,
    );

    const shell = screen.getByRole("searchbox").parentElement?.parentElement;
    expect(shell).toHaveClass("flex-col", "sm:flex-row");
    expect(
      screen.getByRole("button", { name: "Clear search" }).parentElement,
    ).toHaveClass("pointer-coarse:gap-3");
  });

  it("opens the search information on click", () => {
    render(
      <FolderSearch
        id="file-search"
        open
        onOpenChange={vi.fn()}
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search information" }));
    expect(
      screen.getAllByText(
        /Search file names and music details saved on this device/,
      ),
    ).toHaveLength(2);
  });
});
