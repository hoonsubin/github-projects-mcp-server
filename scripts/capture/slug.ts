// =============================================================================
// scripts/capture/slug.ts — derive a filesystem-safe slug from a config path.
// =============================================================================

/** Derive a filesystem-safe slug from a config path. */
export const deriveConfigSlug = (configPath: string): string => {
  if (configPath.startsWith("http://") || configPath.startsWith("https://")) {
    const url = new URL(configPath);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? `remote-0`;
    return last.replace(/\.(yml|yaml)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  const filename = configPath.replace(/\\/g, "/").split("/").pop() ?? "config";
  return filename.replace(/\.(yml|yaml)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
};
