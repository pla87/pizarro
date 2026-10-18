import { TASK_TYPE_META, type TaskTypeValue } from "@/lib/constants";
import { cn } from "./cn";

export function TypeBadge({ type }: { type: TaskTypeValue }) {
  const meta = TASK_TYPE_META[type];
  return <span className={cn("badge", meta.badge)}>{meta.label}</span>;
}
