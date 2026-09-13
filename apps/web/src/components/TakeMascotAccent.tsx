type MascotCharacter = "red" | "green" | "purple" | "blue" | "yellow" | "community" | "handoff";

const mascotSources: Record<MascotCharacter, string> = {
  red: "/assets/take-mascot-handoff-duo.png",
  green: "/assets/take-mascot-carry-green.png",
  purple: "/assets/take-mascot-selected-purple.png",
  blue: "/assets/take-mascot-signal-blue.png",
  yellow: "/assets/take-mascot-cheer-yellow.png",
  community: "/assets/take-mascot-community.png",
  handoff: "/assets/take-mascot-handoff-duo.png",
};

export function TakeMascotAccent({ character, className = "" }: { character: MascotCharacter; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`take-mascot-accent take-mascot-accent--${character}${className ? ` ${className}` : ""}`}
    >
      <img src={mascotSources[character]} alt="" loading="lazy" decoding="async" />
      <i className="take-mascot-accent__spark take-mascot-accent__spark--a" />
      <i className="take-mascot-accent__spark take-mascot-accent__spark--b" />
    </span>
  );
}
