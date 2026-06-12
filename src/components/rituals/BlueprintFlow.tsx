// Blueprint — the initiative-building flow. Input: the bet, stated (domain,
// name, what done looks like). Intelligence: the assistant proposes the whole
// subtree — key results from a baseline, projects in order, each project's
// first tasks. Output: one accepted initiative, fully scaffolded into quiet
// backlog. Nothing lands until you accept.

import { useState } from "react";
import { useVertical, type BlueprintTree } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { ENERGY_META, type Energy } from "../../lib/energy";
import { Btn } from "../ui";

interface DraftKR { name: string; baseline: number; target: number; unit: string; included: boolean }
interface DraftTask { title: string; energy: Energy; durationMins: number }
interface DraftProject { name: string; outcome: string; tasks: DraftTask[]; included: boolean }

export default function BlueprintFlow({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (initiativeId: string) => void;
}) {
  const { data, addInitiativeTree } = useVertical();
  const [domainId, setDomainId] = useState(data.domains[0]?.id ?? "");
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState("");
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [krs, setKrs] = useState<DraftKR[] | null>(null);
  const [projects, setProjects] = useState<DraftProject[] | null>(null);

  const domain = data.domains.find((d) => d.id === domainId);

  const draft = async () => {
    if (!name.trim()) {
      setError("Name the bet first.");
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: { blueprint: { name: name.trim(), outcome: outcome.trim(), description: description.trim(), domainId } },
      });
      if (fnErr) throw fnErr;
      setKrs((res?.keyResults ?? []).map((k: Omit<DraftKR, "included">) => ({ ...k, included: true })));
      setProjects((res?.projects ?? []).map((p: Omit<DraftProject, "included">) => ({ ...p, included: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "drafting failed");
    } finally {
      setDrafting(false);
    }
  };

  const accept = async () => {
    if (!domainId || !name.trim()) return;
    setAccepting(true);
    setError(null);
    try {
      const tree: BlueprintTree = {
        name: name.trim(),
        outcome: outcome.trim(),
        description: description.trim(),
        keyResults: (krs ?? []).filter((k) => k.included),
        projects: (projects ?? []).filter((p) => p.included),
      };
      const id = await addInitiativeTree(domainId, tree);
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "creating failed");
      setAccepting(false);
    }
  };

  const drafted = krs !== null || projects !== null;
  const acceptCount = (krs ?? []).filter((k) => k.included).length +
    (projects ?? []).filter((p) => p.included).reduce((s, p) => s + 1 + p.tasks.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
        <span className="text-[14px] font-semibold tracking-tight">Blueprint</span>
        <span className="mono text-[11px] text-muted">state the bet → {ASSISTANT_NAME} shapes it → you accept it</span>
        <div className="flex-1" />
        <button onClick={onClose} className="keycap">esc</button>
      </header>

      <div className="floor-enter min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div className="mx-auto max-w-[860px]">
          {/* the input: the bet, stated */}
          <div className="rounded-md border border-line bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="section-label">The bet</span>
              <div className="ml-auto flex gap-1">
                {data.domains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDomainId(d.id)}
                    title={d.name}
                    className="fast flex h-7 w-7 items-center justify-center rounded-md text-[13px]"
                    style={{
                      background: d.id === domainId ? `${d.color}26` : "transparent",
                      color: d.color,
                      boxShadow: d.id === domainId ? `0 0 0 1px ${d.color}` : "none",
                    }}
                  >
                    {d.icon}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name the initiative — the bet with a finish line"
              className="w-full bg-transparent text-[18px] font-semibold outline-none placeholder:text-muted/50"
              autoFocus
            />
            <input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="What does done look like, in one line?"
              className="mt-2 w-full bg-transparent text-[13px] outline-none placeholder:text-muted/60"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional: the why, the shape, the constraints…"
              rows={2}
              className="mt-2 w-full resize-y bg-transparent text-[12px] text-muted outline-none placeholder:text-muted/50"
            />
            <div className="mt-3 flex items-center gap-2">
              <Btn kind="primary" onClick={() => void draft()} disabled={drafting}>
                {drafting ? "✦ shaping…" : drafted ? "✦ reshape" : `✦ shape it with ${ASSISTANT_NAME}`}
              </Btn>
              {domain && <span className="mono text-[10px] text-muted">into {domain.name}</span>}
              {error && <span className="text-[11px] text-signal">{error}</span>}
            </div>
          </div>

          {/* the proposal: a draft subtree, yours to prune */}
          {drafted && (
            <div className="mt-6 space-y-6">
              <section>
                <div className="section-label mb-2">Key results — the gain, from a baseline</div>
                <div className="space-y-1.5">
                  {(krs ?? []).map((k, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2">
                      <IncludeBox on={k.included} accent={domain?.color} onToggle={() => setKrs((p) => p!.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))} />
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${k.included ? "" : "text-muted line-through"}`}>{k.name}</span>
                      <span className="mono shrink-0 text-[10px] text-muted">{k.baseline} → {k.target}{k.unit}</span>
                    </div>
                  ))}
                  {(krs ?? []).length === 0 && <div className="text-[12px] text-muted italic">No key results proposed.</div>}
                </div>
              </section>

              <section>
                <div className="section-label mb-2">Projects, in order — tasks land quiet, in backlog</div>
                <div className="space-y-3">
                  {(projects ?? []).map((p, i) => (
                    <div key={i} className="rounded-md border border-line bg-surface" style={{ opacity: p.included ? 1 : 0.5 }}>
                      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2">
                        <IncludeBox on={p.included} accent={domain?.color} onToggle={() => setProjects((prev) => prev!.map((x, j) => (j === i ? { ...x, included: !x.included } : x)))} />
                        <span className="text-[13px] font-medium">{p.name}</span>
                        <span className="mono ml-auto hidden truncate text-[10px] text-muted sm:inline" style={{ maxWidth: 320 }}>{p.outcome}</span>
                      </div>
                      <div className="px-3 py-1.5">
                        {p.tasks.map((t, ti) => (
                          <div key={ti} className="flex items-center gap-2.5 border-b border-line py-1 text-[12px] last:border-0">
                            <span className="mono w-4 shrink-0 text-right text-[9px] text-muted">{String.fromCharCode(97 + ti)}</span>
                            <span className="shrink-0 text-[11px]" style={{ color: domain?.color }}>{ENERGY_META[t.energy]?.icon ?? "·"}</span>
                            <span className="min-w-0 flex-1 truncate">{t.title}</span>
                            <span className="mono shrink-0 text-[10px] text-muted">{t.durationMins}m</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex items-center gap-2">
                <Btn kind="primary" onClick={() => void accept()} disabled={accepting}>
                  {accepting ? "creating…" : `accept → create initiative (${acceptCount} pieces)`}
                </Btn>
                <Btn onClick={onClose}>discard</Btn>
              </div>
            </div>
          )}

          {/* the bare path is always open */}
          {!drafted && (
            <div className="mt-4 text-right">
              <Btn onClick={() => void accept()} disabled={!name.trim() || accepting}>
                {accepting ? "creating…" : "create bare (no AI) →"}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IncludeBox({ on, accent, onToggle }: { on: boolean; accent?: string; onToggle: () => void }) {
  const color = accent ?? "var(--accent)";
  return (
    <button
      onClick={onToggle}
      className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[9px]"
      style={{ borderColor: on ? color : "var(--line)", background: on ? color : "transparent", color: "#fff" }}
    >
      {on ? "✓" : ""}
    </button>
  );
}
