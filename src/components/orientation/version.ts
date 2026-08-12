// Bumped when the walkthrough's content changes enough that a returning user
// should see it again. Lives apart from steps.tsx so useOrientation (entry
// chunk) doesn't drag the step definitions' Visuals into the boot bundle.
export const ORIENTATION_VERSION = 4;
