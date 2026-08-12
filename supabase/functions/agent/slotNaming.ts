// How a block gets its name — one rubric, two callers.
//
// The chat names a block it creates (`create_slot`); the Schedule asks for a
// name for a block the user already made ("suggest a name" in the slot
// popover). Two prompts would give one product two naming voices, and the one
// you'd notice is the bad one. The rubric itself lives in toolDefs.ts with the
// rest of the vocabulary; this builds the standalone ask around it.

import { SLOT_NAMING_RUBRIC } from "./toolDefs.ts";

/** The standalone ask: here is what's inside a block, name it. */
export function slotNamePrompt(contextSection: string, taskList: string): string {
  return `A person has put these pieces of work into one block of time on their calendar. Give the block a name.

${contextSection}The name is ${SLOT_NAMING_RUBRIC}

If the work is clearly one project or one area of their life, name it for that. If it is a mix of small things, name the KIND of work ("Errands", "Emails to send", "Admin sweep"). The person will see this name on their calendar and has to recognise it at a glance a week from now.

What's inside:
${taskList}

Respond with JSON only:
{"name": string}`;
}
