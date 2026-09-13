import { siDiscord, siGithub, siX, type SimpleIcon } from "simple-icons";

type SocialBrand = "x" | "discord" | "github";

const marks: Record<SocialBrand, SimpleIcon> = {
  x: siX,
  discord: siDiscord,
  github: siGithub,
};

export function SocialBrandIcon({ brand, size = 20 }: { brand: SocialBrand; size?: number }) {
  const mark = marks[brand];
  return (
    <svg
      aria-hidden="true"
      className={`social-brand-icon social-brand-icon--${brand}`}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={mark.path} fill="currentColor" />
    </svg>
  );
}
