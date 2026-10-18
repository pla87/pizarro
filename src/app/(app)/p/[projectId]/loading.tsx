export default function Loading() {
  return (
    <div className="flex h-full gap-3 overflow-hidden p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="hidden w-72 shrink-0 animate-pulse rounded-xl bg-slate-200/60 first:block md:block dark:bg-slate-800/60" />
      ))}
    </div>
  );
}
