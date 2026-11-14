// The page bar, handed down to a planner face (D-207, docs/rail-line.md §7).
//
// On the Schedule the rail runs to the top of the panel and the page bar starts
// where the grid starts. The decks (On Deck, at either altitude) do the same:
// FloorPane hands its bar down through this context instead of drawing it
// across the top, and the deck draws it over its grid. `null` everywhere else —
// a deck mounted outside FloorPane (a harness) simply has no bar.

import { createContext, useContext, type ReactNode } from "react";

export const FloorBarContext = createContext<ReactNode>(null);

export const useFloorBar = (): ReactNode => useContext(FloorBarContext);
