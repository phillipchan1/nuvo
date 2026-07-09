// On Deck for the initiative altitude — the initiatives grouped by quarter. The sibling
// of OnDeckFloor (projects → weeks). Thin wrapper so the router stays symmetric
// with the project rung; the surface lives in InitiativeDeck.

import InitiativeDeck from "../ondeck/InitiativeDeck";

export default function InitiativeOnDeckFloor() {
  return <InitiativeDeck />;
}
