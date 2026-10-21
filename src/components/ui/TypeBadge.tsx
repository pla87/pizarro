import { kindBadgeStyle } from "@/lib/constants";

export function TypeBadge({ kind }: { kind: { name: string; color: string } | undefined | null }) {
  if (!kind) return null;
  return (
    <span className="badge kind-badge ring-0" style={kindBadgeStyle(kind.color)}>
      {kind.name}
    </span>
  );
}
