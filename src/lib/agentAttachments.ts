import type { AgentAttachment } from "./agentTypes";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
]);

function uid() {
  return crypto.randomUUID();
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function guessMime(name: string, type: string) {
  if (type) return type;
  const ext = extOf(name);
  if (ext === "md") return "text/markdown";
  if (ext === "csv") return "text/csv";
  if (ext === "json") return "application/json";
  if (ext === "txt") return "text/plain";
  if (ext === "pdf") return "application/pdf";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export function isImageAttachment(a: AgentAttachment) {
  return IMAGE_TYPES.has(a.type);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function filesToAttachments(files: File[]): Promise<{ attachments: AgentAttachment[]; errors: string[] }> {
  const attachments: AgentAttachment[] = [];
  const errors: string[] = [];

  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`${file.name} is too large (max ${formatBytes(MAX_FILE_BYTES)})`);
      continue;
    }

    const type = guessMime(file.name, file.type);
    const isImage = IMAGE_TYPES.has(type);
    const isText = TEXT_TYPES.has(type) || type.startsWith("text/");

    if (!isImage && !isText) {
      errors.push(`${file.name} — unsupported type`);
      continue;
    }

    try {
      if (isImage) {
        attachments.push({
          id: uid(),
          name: file.name,
          type,
          size: file.size,
          dataUrl: await readAsDataUrl(file),
        });
      } else {
        attachments.push({
          id: uid(),
          name: file.name,
          type,
          size: file.size,
          textContent: await readAsText(file),
        });
      }
    } catch {
      errors.push(`Couldn't read ${file.name}`);
    }
  }

  if (files.length > MAX_ATTACHMENTS) {
    errors.push(`Only ${MAX_ATTACHMENTS} files at a time`);
  }

  return { attachments, errors };
}

export function attachmentPromptBlock(a: AgentAttachment): string {
  if (a.textContent != null) {
    return `[Attached file: ${a.name}]\n${a.textContent}`;
  }
  return `[Attached image: ${a.name}]`;
}
