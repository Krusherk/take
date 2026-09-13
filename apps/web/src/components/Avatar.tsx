import { useEffect, useMemo, useState } from "react";
import type { Person } from "../types/product";

interface AvatarProps {
  person?: Pick<Person, "id" | "name" | "avatarUrl">;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "hero";
  className?: string;
}

const fallbackPalettes = [
  ["#c8f05a", "#263319", "#f5f3ee"],
  ["#8b80ff", "#2d2858", "#f5f3ee"],
  ["#73cad2", "#18363a", "#f5f3ee"],
  ["#ec8d77", "#492a25", "#f5f3ee"],
  ["#d7b9ed", "#392844", "#f5f3ee"],
] as const;

function hashIdentity(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : parts[0]?.slice(0, 2) ?? "T").toUpperCase();
}

export function Avatar({ person, size = "md", className = "" }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = person?.avatarUrl ?? null;
  const seed = person?.id ?? person?.name ?? "take-member";
  const palette = useMemo(() => fallbackPalettes[hashIdentity(seed) % fallbackPalettes.length] ?? fallbackPalettes[0], [seed]);
  const label = person ? `${person.name}'s profile picture` : "TAKE member";

  useEffect(() => setImageFailed(false), [imageUrl]);

  return (
    <span className={`avatar avatar--${size} ${className}`} role="img" aria-label={label}>
      {imageUrl && !imageFailed ? (
        <img src={imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      ) : (
        <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
          <rect width="80" height="80" fill={palette[1]} />
          <path d="M-8 71L58 5H88V29L17 88H-8Z" fill={palette[0]} />
          <path d="M-2 18H82M-2 62H82" stroke={palette[2]} strokeOpacity=".18" />
          <circle cx="65" cy="15" r="3" fill={palette[2]} fillOpacity=".9" />
          <text x="40" y="47" fill={palette[2]} fontFamily="Inter Tight, sans-serif" fontSize="22" fontWeight="700" textAnchor="middle">
            {initials(person?.name ?? "TAKE")}
          </text>
        </svg>
      )}
    </span>
  );
}
