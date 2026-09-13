import { keccak256, stringToHex, type Hex } from "viem";

export function hashJson(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) {
      throw new TypeError("Dates must be converted to ISO strings before canonicalization");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Canonical JSON only supports finite numbers");
  }
  if (typeof value === "bigint" || typeof value === "undefined" || typeof value === "function") {
    throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  }
  return JSON.stringify(value);
}
