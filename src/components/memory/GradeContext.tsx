/**
 * The grading sink (docs/memory.md §13.4). A surface that makes a guess — a
 * drafted path today — says what happened to it with `useGrade()(…)`, and the
 * outcome lands in `user_settings.memory.graded`.
 *
 * A context, not a hook that reads settings: the shell above it is memo'd so a
 * settings change doesn't re-render the app, and a sink that subscribed to
 * settings would undo that. This one reads the cache only when it writes. The
 * default is a no-op, so anything mounted without the shell (harnesses, tests)
 * grades into nothing instead of needing the app's data layer.
 */

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchSettings, SETTINGS_KEY } from "../../hooks/useSettings";
import { appendGraded, type GradeIn } from "../../lib/memoryGrade";
import type { MemoryState } from "../../lib/memory";
import type { UserSettings } from "../../lib/types";

export type Grade = (outcomes: GradeIn[]) => void;

const GradeContext = createContext<Grade>(() => {});

export const useGrade = () => useContext(GradeContext);

export function MemoryGradeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const grade = useCallback<Grade>(
    (outcomes) => {
      if (!outcomes.length) return;
      const s = qc.getQueryData<UserSettings>(SETTINGS_KEY);
      // No column yet (migration 94), or learning paused: grade nothing.
      if (!s || !("memory" in s)) return;
      const mem: MemoryState = s.memory ?? {};
      if (mem.learning === false) return;
      patchSettings(qc, { memory: { ...mem, graded: appendGraded(mem.graded, outcomes) } });
    },
    [qc],
  );
  return <GradeContext.Provider value={grade}>{children}</GradeContext.Provider>;
}
