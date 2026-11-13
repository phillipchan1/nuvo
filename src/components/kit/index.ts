// The kit (D-190) — every page is built from these. styles/kit.css draws them.
// Docs: docs/design-language.md § The kit. Every part, every state: `?kit`.
export { Button, IconButton, Kbd, type ButtonKind, type ButtonSize } from "./Button";
export { Input, Textarea, SearchField, FormField } from "./Field";
export { TaskCheck, Checkbox, Switch, Segmented, Tabs, type Choice } from "./Choice";
export { Chip, ChipButton, Dot, Readiness, Avatar, AvatarStack, type ChipTone, type ReadinessStep } from "./Marks";
export { SectionHeader, Row, EmptyState, Property, Card } from "./Structure";
export {
  Popover,
  Menu,
  MenuPanel,
  MenuItem,
  MenuSeparator,
  MenuLabel,
  MenuSearch,
  Picker,
  Select,
  placePopover,
  type Anchor,
  type Placement,
  type PickerOption,
} from "./Popover";
export { MiniMonth, monthGrid } from "./MiniMonth";
export { Dialog } from "./Dialog";
export { PageBar } from "./PageBar";
export { PaceTrack } from "../progress/PaceTrack";
