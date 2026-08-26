import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderSearch } from "@/components/folder-search";

vi.mock("@/components/ui/icon-tooltip", () => ({
  IconTooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Files search control", () => {
  afterEach(cleanup);

  it("defaults to a filename-only Library Search with a two-character hint", () => {
    render(
      <FolderSearch
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
      screen.getByText(/Search checks file names only/),
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

  it("clips native controls to the compound search border", () => {
    render(
      <FolderSearch
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

  it("opens the filename-only information on click", () => {
    render(
      <FolderSearch
        canSearchCurrentFolder
        disabled={false}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="library"
        value=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search information" }));
    expect(screen.getAllByText(/Search checks file names only/)).toHaveLength(
      2,
    );
  });
});
