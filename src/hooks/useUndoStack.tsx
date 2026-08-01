import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { undoCoalesceWindowMs, type UndoTier } from "../lib/undoTiers";

const MAX_STACK = 30;
const TOAST_MS = 6000;
const CONFIRM_MS = 2000;

export interface RecordUndoInput {
  /** Full toast / stack label, e.g. "Marked done — Call David". */
  label: string;
  /** Short phrase for the post-⌘Z confirmation. Defaults to `label`. */
  shortLabel?: string;
  /** When coalescing, rebuild the toast from the running count. */
  batchLabel?: (count: number) => string;
  batchShortLabel?: (count: number) => string;
  undo: () => void | Promise<void>;
  tier: UndoTier;
  coalesceKey?: string;
}

interface StackEntry {
  id: string;
  label: string;
  shortLabel: string;
  batchLabel?: (count: number) => string;
  batchShortLabel?: (count: number) => string;
  undo: () => void | Promise<void>;
  tier: UndoTier;
  coalesceKey?: string;
  count: number;
  at: number;
  toastId?: string | number;
}

interface UndoContextValue {
  recordUndo: (input: RecordUndoInput) => void;
  /** Pop and run the top entry (or a specific id from a toast button). */
  performUndo: (id?: string) => void;
  canUndo: () => boolean;
}

const UndoContext = createContext<UndoContextValue | null>(null);

function isTextEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable=true]"));
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<StackEntry[]>([]);
  // While an undo is running, suppress nested recordUndo from the restore write.
  const undoingRef = useRef(false);

  const dismissToast = (entry: StackEntry) => {
    if (entry.toastId != null) toast.dismiss(entry.toastId);
  };

  const showActionToast = useCallback((entry: StackEntry) => {
    const toastId = entry.coalesceKey ? `undo:${entry.coalesceKey}` : `undo:${entry.id}`;
    entry.toastId = toastId;
    toast(entry.label, {
      id: toastId,
      duration: TOAST_MS,
      action: {
        label: "Undo",
        onClick: () => {
          // Sonner fires onClick then closes; run undo for this entry.
          const idx = stackRef.current.findIndex((e) => e.id === entry.id);
          if (idx < 0) return;
          const [removed] = stackRef.current.splice(idx, 1);
          undoingRef.current = true;
          try {
            void Promise.resolve(removed.undo()).finally(() => {
              undoingRef.current = false;
            });
          } catch {
            undoingRef.current = false;
          }
        },
      },
    });
  }, []);

  const performUndo = useCallback(
    (id?: string) => {
      const stack = stackRef.current;
      let idx = stack.length - 1;
      if (id) {
        const found = stack.findIndex((e) => e.id === id);
        if (found < 0) return;
        idx = found;
      }
      if (idx < 0 || !stack.length) return;
      const [entry] = stack.splice(idx, 1);
      dismissToast(entry);
      undoingRef.current = true;
      try {
        void Promise.resolve(entry.undo()).finally(() => {
          undoingRef.current = false;
        });
      } catch {
        undoingRef.current = false;
      }
      // Brief confirmation after ⌘Z (toast button is self-explanatory).
      if (!id) {
        toast(`Undid: ${entry.shortLabel}`, { duration: CONFIRM_MS });
      }
    },
    [],
  );

  const recordUndo = useCallback(
    (input: RecordUndoInput) => {
      if (undoingRef.current) return;

      const now = Date.now();
      const stack = stackRef.current;
      const shortLabel = input.shortLabel ?? input.label;

      if (input.coalesceKey && stack.length) {
        const last = stack[stack.length - 1];
        if (
          last.coalesceKey === input.coalesceKey &&
          now - last.at < undoCoalesceWindowMs()
        ) {
          const prevUndo = last.undo;
          const nextUndo = input.undo;
          last.undo = () => {
            // Application order was prev then next → undo next then prev.
            const a = nextUndo();
            const b = prevUndo();
            return Promise.all([a, b]).then(() => undefined);
          };
          last.count += 1;
          last.at = now;
          if (input.batchLabel) last.batchLabel = input.batchLabel;
          if (input.batchShortLabel) last.batchShortLabel = input.batchShortLabel;
          if (last.batchLabel) last.label = last.batchLabel(last.count);
          if (last.batchShortLabel) last.shortLabel = last.batchShortLabel(last.count);
          if (last.tier === "toast") showActionToast(last);
          return;
        }
      }

      const entry: StackEntry = {
        id: crypto.randomUUID(),
        label: input.label,
        shortLabel,
        batchLabel: input.batchLabel,
        batchShortLabel: input.batchShortLabel,
        undo: input.undo,
        tier: input.tier,
        coalesceKey: input.coalesceKey,
        count: 1,
        at: now,
      };
      stack.push(entry);
      while (stack.length > MAX_STACK) {
        const dropped = stack.shift();
        if (dropped) dismissToast(dropped);
      }
      if (entry.tier === "toast") showActionToast(entry);
    },
    [showActionToast],
  );

  // ⌘Z / Ctrl+Z — stand down in text fields so native edit undo wins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (e.shiftKey) return; // redo — not in v1
      if (isTextEditing(e.target)) return;
      if (!stackRef.current.length) return;
      e.preventDefault();
      performUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [performUndo]);

  const value = useMemo<UndoContextValue>(
    () => ({
      recordUndo,
      performUndo,
      canUndo: () => stackRef.current.length > 0,
    }),
    [recordUndo, performUndo],
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndoStack(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndoStack must be used within <UndoProvider>");
  return ctx;
}

/** Safe for mutation hooks that may render briefly outside the provider
 *  (e.g. spotlight boot). Returns a no-op recorder when absent. */
export function useOptionalUndoStack(): UndoContextValue {
  const ctx = useContext(UndoContext);
  return (
    ctx ?? {
      recordUndo: () => {},
      performUndo: () => {},
      canUndo: () => false,
    }
  );
}
