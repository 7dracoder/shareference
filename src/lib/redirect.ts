/** A same-origin relative path, never a protocol-relative URL. */
export function safePath(value: unknown, fallback = "/dashboard"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value) ? value : fallback;
}
