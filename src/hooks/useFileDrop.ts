import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

/** True when the drag carries OS files (Chrome, Firefox, WebKit, Tauri webview). */
export function isFileDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  const dt = e.dataTransfer;
  if (!dt) return false;
  const types = [...dt.types];
  if (types.includes("Files") || types.includes("application/x-moz-file")) return true;
  if (dt.items?.length) return [...dt.items].some((item) => item.kind === "file");
  return false;
}

/** Prevent the browser from navigating to a dropped file outside our zones. */
function useGlobalFileDragGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onDragOver = (e: globalThis.DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDrop = (e: globalThis.DragEvent) => {
      if (isFileDrag(e) && !e.defaultPrevented) e.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [enabled]);
}

/** Drag-and-drop file target — attach handlers to any container. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useGlobalFileDragGuard(enabled);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!enabledRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!enabledRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) {
      setDragging(true);
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
    },
    [onFiles],
  );

  return { dragging, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
