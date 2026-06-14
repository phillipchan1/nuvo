import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAgent, type AgentHandle } from "./useAgent";

interface AgentContextValue {
  agent: AgentHandle;
  range: { start: string; end: string };
  setRange: (range: { start: string; end: string }) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

function defaultRange() {
  const now = new Date();
  return {
    start: new Date(now.getTime() - 7 * 86400_000).toISOString(),
    end: new Date(now.getTime() + 7 * 86400_000).toISOString(),
  };
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState(defaultRange);
  const agent = useAgent(range);

  const setRange = useCallback((next: { start: string; end: string }) => {
    setRangeState((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, []);

  const value = useMemo(() => ({ agent, range, setRange }), [agent, range, setRange]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentContext must be used within AgentProvider");
  return ctx;
}
