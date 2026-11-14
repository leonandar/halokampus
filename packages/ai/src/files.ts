export interface FileRule {
  docType: string;
  label: string;
  extensions: string[];
  mimeTypes: string[];
  maxBytes: number;
}

export interface FileCheck {
  ok: boolean;
  problems: string[];
}

/** Completeness/format validation of an uploaded document (FR-14). Content is not inspected or stored. */
export function validateFile(file: { name: string; size: number; mime: string }, rule: FileRule): FileCheck {
  const problems: string[] = [];
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!rule.extensions.includes(ext)) problems.push(`Jenis berkas .${ext} tidak diterima untuk ${rule.label} (diterima: ${rule.extensions.join(", ")})`);
  if (!rule.mimeTypes.includes(file.mime)) problems.push(`Format ${file.mime || "tidak dikenal"} tidak sesuai`);
  if (file.size > rule.maxBytes) problems.push(`Ukuran ${(file.size / 1048576).toFixed(1)} MB melebihi batas ${(rule.maxBytes / 1048576).toFixed(1)} MB`);
  if (file.size === 0) problems.push("Berkas kosong");
  return { ok: problems.length === 0, problems };
}
