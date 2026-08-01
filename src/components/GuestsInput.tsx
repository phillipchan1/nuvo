import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
// One vocabulary for where an address came from — the picker and the chat's
// invite card can't disagree about what "Met before" means.
import { sourceLabel, type ContactSource } from "../../supabase/functions/_shared/invites.ts";

/** Where an address came from. 'meeting' means we only know this person because
 *  they appeared on a synced calendar event — a weaker claim than an address
 *  book, and worth saying so in the row. Defined once in _shared/invites.ts. */
export type { ContactSource };

interface Contact {
  email: string;
  display_name: string;
  freq: number;
  sources: ContactSource[];
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Deterministic pastel hue from an email string.
const AVATAR_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-sky-500", "bg-teal-500",
  "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-pink-500",
];
function avatarColor(email: string) {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string, email: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function Avatar({ email, name, size = "sm" }: { email: string; name: string; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-8 w-8 text-[11px]" : "h-5 w-5 text-[9px]";
  return (
    <span className={`${cls} ${avatarColor(email)} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}>
      {initials(name, email)}
    </span>
  );
}

/** Which address books a suggestion came from. Contacts merge across providers,
 *  so this can legitimately name more than one. */
function SourceLabel({ sources }: { sources: ContactSource[] }) {
  if (!sources?.length) return null;
  return (
    <span className="ml-auto shrink-0 pl-2 text-micro text-muted/70">
      {sources.map(sourceLabel).join(" · ")}
    </span>
  );
}

/** A row in the dropdown. The typed-literal option is modelled alongside real
 *  contacts rather than appended separately — keeping them in one list is what
 *  makes the keyboard index unambiguous, and the split is where the old
 *  "Enter picked a fuzzy stranger" bug lived. */
type Option =
  | { kind: "contact"; contact: Contact }
  | { kind: "literal"; email: string };

/** Chip-style guest input with contact autocomplete over the user's synced
 *  address books (Google People, Apple CardDAV) merged with people seen on
 *  calendar events. */
export function GuestsInput({
  value,
  onChange,
  placeholder = "Add by name or email…",
  contacts: preloadedContacts,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  /** Pre-fetched contact list for instant suggestions on focus (optional). */
  contacts?: Contact[];
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show top contacts on focus even before typing.
  const handleFocus = async () => {
    if (input.trim() || suggestions.length) return;
    const { data } = await supabase.rpc("contacts", { search: "" });
    const filtered = (data ?? []).filter((c: Contact) => !value.includes(c.email));
    if (filtered.length) { setSuggestions(filtered); setOpen(true); setActiveIdx(0); }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (!q) {
      // Keep showing recent contacts when input is cleared but field is focused.
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc("contacts", { search: q });
      const filtered = (data ?? []).filter((c: Contact) => !value.includes(c.email));
      setSuggestions(filtered);
      setOpen(filtered.length > 0 || isValidEmail(q));
      setActiveIdx(0);
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [input, value]);

  // Cache display names for added emails so chips show names, not just emails.
  const nameCache = useRef<Record<string, string>>({});

  // Pre-populate cache from preloaded contacts.
  useEffect(() => {
    (preloadedContacts ?? []).forEach((c) => { nameCache.current[c.email] = c.display_name; });
  }, [preloadedContacts]);

  /** A complete address the user typed is an explicit instruction, so it leads
   *  the list and is the default selection. Fuzzy matches still follow (a typo'd
   *  address should still be rescuable), but they can no longer be committed by
   *  accident: typing a stranger's address used to hand Enter whichever frequent
   *  contact happened to share their mail domain. */
  const options: Option[] = useMemo(() => {
    const q = input.trim().toLowerCase();
    const typedIsEmail = isValidEmail(q);
    const alreadyListed = suggestions.some((s) => s.email === q);
    const literal: Option[] = typedIsEmail && !alreadyListed ? [{ kind: "literal", email: q }] : [];
    return [...literal, ...suggestions.map((c) => ({ kind: "contact" as const, contact: c }))];
  }, [input, suggestions]);

  // Never let a stale index point past a shrinking list.
  const safeIdx = Math.min(activeIdx, Math.max(0, options.length - 1));

  const add = (email: string, name?: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || value.includes(normalized)) return;
    onChange([...value, normalized]);
    if (name) nameCache.current[normalized] = name;
    setInput("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const remove = (email: string) => onChange(value.filter((e) => e !== email));

  const commitOption = (opt: Option | undefined) => {
    if (!opt) return;
    if (opt.kind === "literal") add(opt.email);
    else add(opt.contact.email, opt.contact.display_name);
  };

  const commit = () => {
    if (open && options.length) { commitOption(options[safeIdx]); return; }
    // Closed list (or nothing matched): a valid address still commits.
    if (isValidEmail(input.trim())) add(input.trim());
  };

  const chipLabel = (email: string) => nameCache.current[email] ?? email;

  return (
    <div className="flex flex-col gap-2">
      {/* Chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/8 py-0.5 pl-0.5 pr-2 text-meta text-accent"
            >
              <Avatar email={email} name={chipLabel(email)} size="sm" />
              <span className="max-w-[140px] truncate">{chipLabel(email)}</span>
              <button
                type="button"
                onClick={() => remove(email)}
                className="fast tap -ml-0.5 leading-none text-accent/50 hover:text-accent"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 focus-within:border-accent">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/60">
            <path d="M5.5 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-4 3a4 4 0 1 1 7.02 2.62l1.98 1.98-.7.7-1.98-1.98A4 4 0 0 1 1.5 5z" fill="currentColor" />
          </svg>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "," || e.key === "Tab") { e.preventDefault(); commit(); }
              if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(Math.min(safeIdx + 1, options.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(Math.max(safeIdx - 1, 0)); }
              if (e.key === "Escape") { setOpen(false); setInput(""); }
              if (e.key === "Backspace" && !input && value.length) { remove(value[value.length - 1]); }
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={value.length === 0 ? placeholder : "Add another…"}
            className="flex-1 bg-transparent text-body outline-none placeholder:text-muted/40"
            // Plain text input so iOS dictation works (low-data-entry principle).
            type="text"
            autoComplete="off"
          />
        </div>

        {open && options.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[280px] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface shadow-[var(--shadow-3)]">
            {options.map((opt, i) => {
              const active = i === safeIdx;
              if (opt.kind === "literal") {
                return (
                  <li key="__literal">
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); add(opt.email); }}
                      className={`fast tap flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                        active ? "bg-accent/8" : "hover:bg-bg"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted/30 text-muted">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className={`truncate text-body ${active ? "text-accent" : "text-ink"}`}>
                          Invite <span className="font-medium">{opt.email}</span>
                        </span>
                        <span className="text-meta text-muted">Not in your contacts — add anyway</span>
                      </div>
                    </button>
                  </li>
                );
              }
              const c = opt.contact;
              return (
                <li key={c.email}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); add(c.email, c.display_name); }}
                    className={`fast tap flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                      active ? "bg-accent/8" : "hover:bg-bg"
                    }`}
                  >
                    <Avatar email={c.email} name={c.display_name} size="md" />
                    <div className="flex min-w-0 flex-col">
                      <span className={`truncate text-body font-medium leading-tight ${active ? "text-accent" : "text-ink"}`}>
                        {c.display_name !== c.email ? c.display_name : c.email}
                      </span>
                      {c.display_name !== c.email && (
                        <span className="truncate text-meta text-muted">{c.email}</span>
                      )}
                    </div>
                    <SourceLabel sources={c.sources} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
