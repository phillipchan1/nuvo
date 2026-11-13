import { useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import {
  Avatar,
  AvatarStack,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipButton,
  Dialog,
  Dot,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  Dest,
  Menu,
  MenuItem,
  MenuLabel,
  MenuPanel,
  MenuSeparator,
  MiniMonth,
  PaceTrack,
  Picker,
  Property,
  Readiness,
  Row,
  SearchField,
  SectionHeader,
  Segmented,
  Select,
  Switch,
  Tabs,
  TaskCheck,
  Textarea,
} from "./index";
import DeckCard from "../ondeck/DeckCard";

// ?kit — every part of the kit, every state, Light and Dark side by side
// (D-190). Static states that a pointer would normally produce (hover, press,
// focus) are forced with harness-only classes below, so one screenshot shows
// the whole vocabulary. The popovers and the dialog at the top are live.

const HUES = {
  work: "#4f5fd6",
  health: "#1e9467",
  family: "#c0841a",
  writing: "#c23f72",
};

const FORCE = `
.kh .kh-hover.k-btn:not([data-kind="ghost"]) { background-image: linear-gradient(var(--hover) 0 0); }
.kh .kh-hover.k-btn[data-kind="ghost"] { background-color: var(--hover); color: var(--ink); }
.kh .kh-hover.k-btn[data-kind="primary"] { background-image: linear-gradient(color-mix(in srgb, var(--mix) 10%, transparent) 0 0); }
.kh .kh-press.k-btn { transform: scale(0.98); background-image: linear-gradient(var(--press) 0 0); }
.kh .kh-focus.k-btn { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--accent-ring); }
.kh .kh-hover.k-row { background: var(--hover); }
.kh .kh-hover.k-mi { background: var(--hover); }
.kh .kh-hover.k-card { box-shadow: 0 0 0 1px var(--line-2), var(--sh-1); }
.kh .kh-focus .k-field, .kh .kh-focus.k-field { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
`;

function Block({ title, part, children }: { title: string; part: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12, padding: 16, borderRadius: "var(--r-card)", boxShadow: "0 0 0 1px var(--line-1)", background: "var(--panel)", minWidth: 0 }}>
      <h3 style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 8, font: "650 13px/1.2 var(--font-sans)" }}>
        {title}
        <code style={{ font: "500 11px var(--font-mono)", color: "var(--faint)" }}>{part}</code>
      </h3>
      {children}
    </section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ width: 56, flex: "none", fontSize: 11, color: "var(--faint)" }}>{label}</span>
      {children}
    </div>
  );
}

function Column({ theme }: { theme: "light" | "dark" }) {
  const [view, setView] = useState<"week" | "month" | "year">("week");
  const [tab, setTab] = useState<"deck" | "groom" | "table" | "shipped">("groom");
  const [kind, setKind] = useState<"task" | "event" | "slot">("task");
  const [done, setDone] = useState(false);
  const [box, setBox] = useState(true);
  const [sw, setSw] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [day, setDay] = useState<Date | null>(new Date(2026, 10, 20));
  const plus = <Icon name="plus" size={14} />;

  return (
    <div data-theme={theme} className="kh" style={{ background: "var(--ground)", color: "var(--ink)", padding: 16, borderRadius: 12, display: "grid", gap: 16, minWidth: 0, alignContent: "start" }}>
      <div style={{ font: "700 20px/1 var(--font-sans)", letterSpacing: "-0.025em" }}>{theme === "light" ? "Light" : "Dark"}</div>

      <Block title="Button" part="Button · IconButton">
        <Line label="Kind">
          <Button kind="primary" icon={plus} shortcut="P">New project</Button>
          <Button>Secondary</Button>
          <Button kind="ghost">Ghost</Button>
          <Button kind="danger">Delete</Button>
          <Button kind="danger-solid">Delete</Button>
        </Line>
        <Line label="State">
          <Button>Rest</Button>
          <Button className="kh-hover">Hover</Button>
          <Button className="kh-press">Press</Button>
          <Button className="kh-focus">Focus</Button>
          <Button disabled>Disabled</Button>
          <Button active>On</Button>
        </Line>
        <Line label="Size">
          <Button size="xs">24</Button>
          <Button>28</Button>
          <Button size="md">32</Button>
          <IconButton size="xs" label="Add" icon={plus} />
          <IconButton label="Add" icon={plus} />
          <IconButton size="md" kind="secondary" label="Add" icon={plus} shortcut="A" />
          <IconButton label="More" icon={<Icon name="more" size={14} />} className="kh-hover" />
        </Line>
        <Line label="Destination">
          <div style={{ display: "flex", gap: 6, width: 240, minWidth: 0 }}>
            <Button kind="primary" shortcut="X"><Dest verb="Back to" name="Launch pricing page for the spring catalogue" /></Button>
          </div>
        </Line>
        <Line label="Keycap">
          <Kbd keys="P" />
          <Kbd keys={["⌘", "K"]} />
          <Kbd keys={["⌥", "Space"]} />
          <Kbd keys="↵" />
        </Line>
      </Block>

      <Block title="Field" part="Input · Textarea · SearchField · Select">
        <Line label="Input">
          <Input placeholder="Outcome" style={{ width: 150 }} />
          <span className="kh-focus"><Input defaultValue="Ship v2" style={{ width: 120 }} /></span>
          <Input invalid defaultValue="25:00" style={{ width: 90 }} />
          <Input disabled placeholder="Disabled" style={{ width: 110 }} />
        </Line>
        <Line label="Kinds">
          <SearchField placeholder="Search" style={{ width: 140 }} />
          <Input size="sm" placeholder="28px" icon={<Icon name="clock" size={14} />} trailing={<Kbd keys="T" />} style={{ width: 110 }} />
          <Select
            label="Week starts on"
            value="mon"
            onChange={() => {}}
            options={[
              { value: "sun", label: "Sunday" },
              { value: "mon", label: "Monday" },
            ]}
          />
        </Line>
        <Textarea placeholder="Notes" rows={2} />
      </Block>

      <Block title="Choice" part="TaskCheck · Checkbox · Switch · Segmented · Tabs">
        <Line label="Task">
          <TaskCheck checked={false} onChange={() => {}} label="Open" />
          <TaskCheck checked onChange={() => {}} label="Done" />
          <TaskCheck checked={done} onChange={setDone} label="Toggle" />
          <TaskCheck checked={false} onChange={() => {}} label="Large" size="lg" />
          <TaskCheck checked onChange={() => {}} label="Large done" size="lg" />
        </Line>
        <Line label="Box">
          <Checkbox checked={false} onChange={() => {}} label="Off" />
          <Checkbox checked onChange={() => {}} label="On" />
          <Checkbox checked="mixed" onChange={() => {}} label="Some" />
          <Checkbox checked={box} onChange={setBox} label="Toggle" />
          <Checkbox checked={false} disabled onChange={() => {}} label="Disabled" />
        </Line>
        <Line label="Switch">
          <Switch checked={false} onChange={() => {}} label="Off" />
          <Switch checked onChange={() => {}} label="On" />
          <Switch checked={sw} onChange={setSw} label="Toggle" />
          <Switch checked disabled onChange={() => {}} label="Disabled" />
        </Line>
        <Line label="Segment">
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} />
          <Segmented size="sm" label="Kind" value={kind} onChange={setKind} options={[{ value: "task", label: "Task" }, { value: "event", label: "Event" }, { value: "slot", label: "Slot" }]} />
        </Line>
        <div style={{ height: 32, borderBottom: "1px solid var(--line-1)", display: "flex" }}>
          <Tabs
            label="Projects"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "deck", label: "On Deck" },
              { value: "groom", label: "Groom", count: 3 },
              { value: "table", label: "Table" },
              { value: "shipped", label: "Shipped" },
            ]}
          />
        </div>
      </Block>

      <Block title="Marks" part="Chip · Dot · Readiness · Avatar · PaceTrack">
        <Line label="Chip">
          <Chip dot={HUES.work}>Work</Chip>
          <Chip>W46</Chip>
          <Chip tone="accent">Ready</Chip>
          <Chip tone="signal">Overdue</Chip>
          <Chip tone="danger">Failed</Chip>
          <Chip tone="ok">Shipped</Chip>
          <ChipButton dot={HUES.health}>Health</ChipButton>
        </Line>
        <Line label="Dot">
          <Dot color={HUES.work} />
          <Dot color={HUES.health} />
          <Dot color={HUES.family} shape="round" />
          <Dot color={HUES.writing} size="sm" />
        </Line>
        <Line label="Ready">
          <Readiness step={0} />
          <Readiness step={1} />
          <Readiness step={2} />
          <Readiness step={3} />
          <Readiness step="shipped" />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>raw · 1 · 2 · ready</span>
        </Line>
        <Line label="People">
          <Avatar name="Phil Chan" color={HUES.work} />
          <Avatar name="Priya Rao" color={HUES.writing} size="lg" />
          <AvatarStack
            people={[
              { name: "Priya Rao", color: HUES.writing },
              { name: "Dana Smith", color: HUES.family },
              { name: "Sam Lee", color: HUES.health },
              { name: "Max Ito", color: HUES.work },
              { name: "Ana Diaz", color: HUES.writing },
            ]}
          />
        </Line>
        <Line label="Pace">
          <PaceTrack done={7} total={9} elapsed={0.6} color={HUES.work} width={180} />
          <PaceTrack done={2} total={6} elapsed={0.5} color={HUES.writing} width={120} />
        </Line>
      </Block>

      <Block title="Structure" part="SectionHeader · Row · EmptyState · Property · Card">
        <div style={{ borderRadius: "var(--r-card)", boxShadow: "0 0 0 1px var(--line-1)", padding: 4, background: "var(--panel)" }}>
          <SectionHeader title="On the clock" count={6} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} actions={<IconButton size="xs" label="Add" icon={plus} />} />
          {!collapsed && (
            <>
              <Row leading={<TaskCheck checked={false} onChange={() => {}} label="Review activation data" />} title="Review activation data" meta="4–5:30pm" trailing={<Dot color={HUES.work} />} onActivate={() => {}} />
              <Row className="kh-hover" leading={<TaskCheck checked={false} onChange={() => {}} label="Draft slides" />} title="Draft slides · hover" meta="30m" trailing={<Dot color={HUES.writing} />} onActivate={() => {}} />
              <Row selected leading={<TaskCheck checked={false} onChange={() => {}} label="Pricing experiment design" />} title="Pricing experiment design · selected" meta="2–4pm" trailing={<Dot color={HUES.work} />} onActivate={() => {}} />
              <Row done leading={<TaskCheck checked onChange={() => {}} label="Run 5k" />} title="Run 5k · done" meta="8am" trailing={<Dot color={HUES.health} />} />
              <Row density="comfy" leading={<Readiness step={3} />} title="Onboarding flow v2 · 38px list row" meta="7/9" />
            </>
          )}
          <EmptyState icon={<Icon name="check" size={20} />}>Nothing today</EmptyState>
        </div>
        <div style={{ display: "grid", gap: 2, maxWidth: 300 }}>
          <Property label="Status" onClick={() => {}}>
            <Readiness step={3} />
            In flight
          </Property>
          <Property label="Domain" onClick={() => {}}>
            <Dot color={HUES.work} />
            Work
          </Property>
          <Property label="Target" onClick={() => {}} empty>
            Set target
          </Property>
          <Property label="Week">W46</Property>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          <Card interactive>
            <strong style={{ fontWeight: 600 }}>Hiring loop</strong>
            <Chip dot={HUES.work}>Work</Chip>
          </Card>
          <Card interactive className="kh-hover">
            <strong style={{ fontWeight: 600 }}>Hover</strong>
            <Chip dot={HUES.writing}>Writing</Chip>
          </Card>
          <Card selected>
            <strong style={{ fontWeight: 600 }}>Selected</strong>
            <Chip dot={HUES.health}>Health</Chip>
          </Card>
        </div>
        {/* The deck card's states — ready and shipped must never read alike. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          <DeckCard spine={HUES.work} eyebrow="" mark={false} title="Build staff rigor plan" weight="1.5h" pips={[true, true, true]} />
          <DeckCard spine={HUES.work} eyebrow="" mark={false} title="Create spiritual gifts test V1" weight="2.3h" pips={[true, true, false]} status={{ label: "1d overdue", tone: "danger" }} />
          <DeckCard spine={HUES.work} eyebrow="" mark={false} title="Move church accounts to named owners" pips={[true, true, true]} shipped status={{ label: "shipped", tone: "landed" }} />
        </div>
      </Block>

      <Block title="Popover" part="MenuPanel · MenuItem · MiniMonth">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <MenuPanel style={{ width: 236 }}>
            <MenuItem icon={<Icon name="arrow-right" size={14} />} shortcut="↵">Open</MenuItem>
            <MenuItem icon={<Icon name="clock" size={14} />} shortcut="S">Schedule…</MenuItem>
            <MenuItem icon={<Icon name="tag" size={14} />} submenu>Labels</MenuItem>
            <MenuItem icon={<Icon name="copy" size={14} />} shortcut={["⌘", "L"]}>Copy link</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Icon name="trash" size={14} />} shortcut="⌫" danger>Delete</MenuItem>
          </MenuPanel>
          <MenuPanel style={{ width: 200 }}>
            <MenuLabel>Domain</MenuLabel>
            <MenuItem icon={<Dot color={HUES.work} />} checked>Work</MenuItem>
            <MenuItem icon={<Dot color={HUES.health} />} checked={false}>Health</MenuItem>
            <MenuItem icon={<Dot color={HUES.family} />} checked={false}>Family</MenuItem>
            <MenuItem icon={<Dot color={HUES.writing} />} checked={false} disabled>Writing</MenuItem>
          </MenuPanel>
          <MenuPanel role="group">
            <MiniMonth value={day} onChange={setDay} today={new Date(2026, 10, 12)} />
          </MenuPanel>
        </div>
      </Block>
    </div>
  );
}

function Live() {
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const [pickAt, setPickAt] = useState<HTMLElement | null>(null);
  const [domain, setDomain] = useState<string>("work");
  const [dialog, setDialog] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginRight: 4 }}>Live</span>
      <Button icon={<Icon name="more" size={14} />} onClick={(e) => setMenuAt(menuAt ? null : e.currentTarget)}>
        Menu
      </Button>
      <Button icon={<Dot color={HUES[domain as keyof typeof HUES]} />} trailing={<Icon name="chevron-down" size={12} />} onClick={(e) => setPickAt(pickAt ? null : e.currentTarget)}>
        {domain[0].toUpperCase() + domain.slice(1)}
      </Button>
      <Button kind="primary" onClick={() => setDialog(true)}>
        Open dialog
      </Button>
      <Menu anchor={menuAt} open={!!menuAt} onClose={() => setMenuAt(null)} label="Task">
        <MenuItem icon={<Icon name="arrow-right" size={14} />} shortcut="↵">Open</MenuItem>
        <MenuItem icon={<Icon name="clock" size={14} />} shortcut="S">Schedule…</MenuItem>
        <MenuItem icon={<Icon name="copy" size={14} />} shortcut={["⌘", "L"]}>Copy link</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Icon name="trash" size={14} />} shortcut="⌫" danger>Delete</MenuItem>
      </Menu>
      <Picker
        anchor={pickAt}
        open={!!pickAt}
        onClose={() => setPickAt(null)}
        label="Domain"
        value={domain}
        onChange={(v) => {
          setDomain(v);
          setPickAt(null);
        }}
        options={(Object.keys(HUES) as (keyof typeof HUES)[]).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1), icon: <Dot color={HUES[k]} /> }))}
        footer={<MenuItem icon={<Icon name="plus" size={14} />}>New domain</MenuItem>}
      />
      {dialog && (
        <Dialog
          title="Delete project"
          onClose={() => setDialog(false)}
          footer={
            <>
              <Button kind="ghost" onClick={() => setDialog(false)}>Cancel</Button>
              <Button kind="danger-solid" shortcut="↵" onClick={() => setDialog(false)}>Delete</Button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--muted)" }}>Onboarding flow v2 and its 9 steps.</p>
        </Dialog>
      )}
    </div>
  );
}

export default function KitHarness() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--ground)", color: "var(--ink)", padding: "20px max(16px, env(safe-area-inset-left))", display: "grid", gap: 16, alignContent: "start" }}>
      <style>{FORCE}</style>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, font: "700 28px/1 var(--font-sans)", letterSpacing: "-0.034em" }}>Kit</h1>
        <span style={{ color: "var(--muted)" }}>every part, every state · D-190</span>
      </div>
      <Live />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))", gap: 16 }}>
        <Column theme="light" />
        <Column theme="dark" />
      </div>
    </div>
  );
}
