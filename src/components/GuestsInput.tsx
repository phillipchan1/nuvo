import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Avatar, Input } from "./kit";
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

/** Which address books a suggestion came from. Contacts merge across providers,
 *  so this can legitimately name more than one. Sits under the email rather
 *  than beside the name — competing for the same line as a long label like
 *  "Met before" forced the name/email column to swallow the squeeze, which is
 *  what made long names/emails truncate down to a couple of characters. */
function SourceLabel({ sources }: { sources: ContactSource[] }) {
  if (!sources?.length) return null;
  return (
    <span className="gi-src">{sources.map(sourceLabel).join(" · ")}</span>
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
    <div className="gi">
      {/* Chips */}
      {value.length > 0 && (
        <div className="gi-chips">
          {value.map((email) => (
            <span key={email} className="k-chip gi-chip">
              <Avatar name={chipLabel(email)} />
              <span>{chipLabel(email)}</span>
              <button
                type="button"
                onClick={() => remove(email)}
                className="gi-x tap-bloom"
                aria-label={`Remove ${email}`}
                title={`Remove ${chipLabel(email)}`}
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="relative">
        <Input
          ref={inputRef}
          icon={<Icon name="users" size={14} />}
          frameClassName="tap-h"
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
          placeholder={value.length === 0 ? placeholder : "Add another"}
          // Plain text input so iOS dictation works (low-data-entry principle).
          type="text"
          autoComplete="off"
          // Names/emails aren't prose — WebKit's autocorrect bubble (the Tauri
          // shell is WKWebView) would otherwise float a suggestion chip right
          // over this dropdown's own suggestions.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {open && options.length > 0 && (
          <ul className="gi-menu" role="listbox" aria-label="Suggestions">
            {options.map((opt, i) => {
              const active = i === safeIdx;
              if (opt.kind === "literal") {
                return (
                  <li key="__literal">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => { e.preventDefault(); add(opt.email); }}
                      className="gi-opt tap-h"
                      data-lit={active || undefined}
                    >
                      <span className="gi-new" aria-hidden>
                        <Icon name="plus" size={12} />
                      </span>
                      <span className="gi-who">
                        <b>Invite {opt.email}</b>
                        <small>Not in your contacts</small>
                      </span>
                    </button>
                  </li>
                );
              }
              const c = opt.contact;
              return (
                <li key={c.email}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => { e.preventDefault(); add(c.email, c.display_name); }}
                    className="gi-opt tap-h"
                    data-lit={active || undefined}
                  >
                    <Avatar name={c.display_name || c.email} size="lg" />
                    <span className="gi-who">
                      <b>{c.display_name !== c.email ? c.display_name : c.email}</b>
                      {c.display_name !== c.email && <small>{c.email}</small>}
                    </span>
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
