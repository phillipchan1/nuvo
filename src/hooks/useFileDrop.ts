import { useCallback, useRef, useState, type DragEvent } from "react";

/** Drag-and-drop file target — attach handlers to any container. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current += 1;
      if (e.dataTransfer.types.includes("Files")) setDragging(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [enabled],
  );

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    depthRef.current -= 1;
    if (depthRef.current <= 0) {
      depthRef.current = 0;
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();
      depthRef.current = 0;
      setDragging(false);
      if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
    },
    [enabled, onFiles],
  );

  return { dragging, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
