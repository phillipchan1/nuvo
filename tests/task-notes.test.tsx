// @vitest-environment jsdom
//
// A task's notes are a plain string, and the things in them you can act on — a phone
// number, an email, a link — are tappable once you aren't typing. A <textarea> can't
// hold a link, so the field has two faces (read / edit) and these pin the handoff:
//
//   · notes with nothing to tap are just the textarea, as they always were — no extra
//     tap, and empty notes cost nothing;
//   · notes with a number read as links; a tap on the link acts, a tap anywhere else
//     opens the editor with the caret at the end, inside the same gesture;
//   · typing a number into plain notes never swaps the editor out from under the caret.
//
// The tap-to-call itself — whether iOS dials — can't be proven here; see
// tests/external-links.test.ts for why every link is an `<a target="_blank">`.

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TaskNotes from "../src/components/TaskNotes";
import { DescriptionHtml } from "../src/lib/descriptionHtml";

afterEach(() => cleanup());

// jsdom would try to navigate on an anchor click — nothing under test wants that.
beforeEach(() => {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener("click", stop);
  return () => document.removeEventListener("click", stop);
});

function Notes({ initial, onBlur }: { initial: string; onBlur?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TaskNotes
      value={value}
      onBlur={onBlur}
      readClassName="field"
      renderEditor={({ inputRef, onFocus, onBlur: handoff }) => (
        <textarea
          ref={inputRef}
          aria-label="Notes"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={onFocus}
          onBlur={handoff}
        />
      )}
    />
  );
}

const NOTE = "Frontier Loyalty: 1-800-921-8101, Mon–Fri 8am–8pm ET.";
const readFace = () => screen.getByRole("group", { name: /Notes/ });

describe("TaskNotes — which face shows", () => {
  it("is just the textarea when there is nothing to tap", () => {
    render(<Notes initial="Check the competitor grid first." />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("is just the textarea when empty — a fresh account's notes cost nothing", () => {
    render(<Notes initial="" />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("reads as text with a tappable number when the notes hold one", () => {
    render(<Notes initial={NOTE} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    const link = screen.getByRole("link", { name: "1-800-921-8101" });
    expect(link.getAttribute("href")).toBe("tel:18009218101");
    // Same anchor shape as every other link the app draws — the native shells open
    // links through a handler that only takes `_blank` ones.
    expect(link.getAttribute("target")).toBe("_blank");
    // The rest of the sentence is still there, in order.
    expect(readFace().textContent).toBe(NOTE);
  });

  it("lets a link wrap exactly as the words around it do — the textarea does, and a swap must not reflow", () => {
    // `break-all` split "maya" / "@example.com" across a line end in the read face while the
    // textarea moved the whole address down: the field jumped on every swap (seen live, 375px).
    render(<Notes initial={NOTE} />);
    const cls = screen.getByRole("link", { name: "1-800-921-8101" }).className;
    expect(cls).not.toContain("break-all");
    expect(cls).not.toContain("whitespace-nowrap");
  });

  it("keeps the note's line breaks", () => {
    render(<Notes initial={"Call 626-555-0100\n\nAsk for Maya"} />);
    expect(readFace().className).toContain("whitespace-pre-wrap");
    expect(readFace().textContent).toBe("Call 626-555-0100\n\nAsk for Maya");
  });
});

describe("TaskNotes — the handoff", () => {
  it("a tap on the words opens the editor, focused, caret at the end", () => {
    render(<Notes initial={NOTE} />);
    fireEvent.click(readFace());

    const box = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe(NOTE);
    expect(box.selectionStart).toBe(NOTE.length);
    expect(box.selectionEnd).toBe(NOTE.length);
  });

  it("a tap on the number acts on it and does NOT open the editor", () => {
    render(<Notes initial={NOTE} />);
    fireEvent.click(screen.getByRole("link", { name: "1-800-921-8101" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "1-800-921-8101" })).toBeTruthy();
  });

  it("the end of a drag-select keeps the selection instead of opening the editor", () => {
    render(<Notes initial={NOTE} />);
    const range = document.createRange();
    range.selectNodeContents(readFace());
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.click(readFace());
    expect(screen.queryByRole("textbox")).toBeNull();
    sel.removeAllRanges();
  });

  it("Enter on the read face opens the editor — the keyboard has the same way in", () => {
    render(<Notes initial={NOTE} />);
    fireEvent.keyDown(readFace(), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Notes" }));
  });

  it("goes back to the read face on blur, and tells the surface to commit", () => {
    const commit = vi.fn();
    render(<Notes initial={NOTE} onBlur={commit} />);
    fireEvent.click(readFace());
    expect(commit).not.toHaveBeenCalled();

    fireEvent.blur(screen.getByRole("textbox", { name: "Notes" }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "1-800-921-8101" })).toBeTruthy();
  });

  it("typing a number into plain notes never swaps the editor out from under the caret", () => {
    render(<Notes initial="Call about the bill" />);
    const box = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;

    // Focusing is what holds the editor in place…
    fireEvent.focus(box);
    // …so the moment the text becomes actionable mid-sentence, the box is still the box.
    fireEvent.change(box, { target: { value: "Call about the bill: 626-555-0100" } });
    expect(screen.getByRole("textbox", { name: "Notes" })).toBe(box);
    expect(screen.queryByRole("link")).toBeNull();

    // Only leaving the field turns the number into a link.
    fireEvent.blur(box);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "626-555-0100" }).getAttribute("href")).toBe("tel:6265550100");
  });
});

// The invite bodies and the notes draw links with ONE renderer, so a number reads the
// same in both — and an anchor never nests inside an anchor.
describe("DescriptionHtml — the same recognition", () => {
  it("makes a dial-in number and an organiser's email tappable in a plain-text invite", () => {
    const { container } = render(
      <DescriptionHtml html={"Dial in: +1 323-555-0100\nQuestions: maya@example.com"} className="text-caption" />,
    );
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["tel:+13235550100", "mailto:maya@example.com"]);
  });

  it("does not nest an anchor in an anchor", () => {
    const { container } = render(
      <DescriptionHtml
        html={'<a href="https://zoom.us/j/123">Join or call +1 323-555-0100</a>'}
        className="text-caption"
      />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a a")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://zoom.us/j/123");
  });
});
