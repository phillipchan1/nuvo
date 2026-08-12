/**
 * Ask Nuvo — and watch it show its work.
 *
 * The claim this visual has to carry is not "it has an AI." Every planner has
 * an AI now. The claim is *restraint made visible*: it does the thing, it
 * renders exactly what it changed as a live record card, and the card carries a
 * one-tap undo. That is Principle 3 (**Nuvo proposes; you promote**) and
 * Principle 4 (**the app reports; you decide**) drawn instead of asserted, and
 * it is the sharpest possible contrast with the tool right below it in the
 * field table — Motion, which places the work and takes the call.
 *
 * Recreates `src/components/AgentRecordCards.tsx` (the card + its `Restore`
 * button, driven by `useAgentUndo`) and `AgentMessageBubble.tsx`. The acts named
 * here are real tools in `supabase/functions/agent/toolDefs.ts` — `create_task`,
 * `schedule_task`, `create_project`. Thirty-eight of them ship; the three shown
 * are the ones a stranger can evaluate without knowing the vocabulary.
 *
 * Deliberately NOT shown: `point_at` (the Marquee wedge is desktop-only and its
 * edge function needs a deploy), and anything that would read as the assistant
 * running the day on its own.
 */

import { WORK } from './hues'

export default function ChatVisual() {
  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <span className="text-[13px] text-[var(--accent)]">✦</span>
        <p className="section-label text-[var(--muted)]">Ask Nuvo</p>
        <span className="mono ml-auto text-[10px] text-[var(--muted)]">⌘J</span>
      </div>

      <div className="space-y-3 px-4 py-4">
        {/* Plain language in. No syntax to learn, no command palette grammar. */}
        <div className="flex justify-end">
          <p className="max-w-[86%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-3 py-2 text-[12.5px] leading-snug text-white">
            the Meridian launch needs a run-through before Thursday — find me 90 minutes
          </p>
        </div>

        <div className="flex justify-start">
          <p className="max-w-[88%] rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[12.5px] leading-snug text-[var(--text)]">
            Wednesday 2:00–3:30 was your only clear stretch before Thursday. Put it there and
            attached it to Meridian launch.
          </p>
        </div>

        {/* The record it touched, live — not a receipt, the row itself. This is
            the half that earns trust: you can see precisely what moved. */}
        <div
          className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
          style={{ borderLeft: `3px solid ${WORK}` }}
        >
          <div className="px-3 pb-2.5 pt-2">
            <p className="section-label text-[8px]" style={{ color: WORK }}>
              TASK · SCHEDULED
            </p>
            <p className="mt-1 text-[12.5px] font-medium leading-snug text-[var(--text)]">
              Run-through — Meridian launch
            </p>
            <p className="mono mt-1 text-[11px] text-[var(--muted)]">
              Wed Jul 30 · 2:00–3:30p · Meridian launch
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-1.5">
            <span className="mono text-[10px] text-[var(--muted)]">Nuvo did this</span>
            <span className="mono rounded-full border border-[var(--line-strong)] px-2 py-0.5 text-[10px] text-[var(--text)]">
              ↩ Restore
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
