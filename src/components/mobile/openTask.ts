/**
 * How a list on the phone opens a task: the shell's task sheet.
 *
 * The phone's detail screens live inside `MobileDetailSheet`, far from the
 * shell that owns the task sheet, and used to draw their own reduced row with
 * rename / length / delete inline because they had no way to open the real
 * one. The shell provides this; any list on the phone can now open the same
 * sheet a Today row opens (one grammar per noun, D-111).
 */

import { createContext, useContext } from "react";

export const MobileOpenTaskContext = createContext<((taskId: string) => void) | null>(null);

export function useMobileOpenTask(): ((taskId: string) => void) | null {
  return useContext(MobileOpenTaskContext);
}
