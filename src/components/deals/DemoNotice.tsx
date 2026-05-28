import { isDemoMode } from "@/lib/demo/mode";

export function DemoNotice() {
  if (!isDemoMode()) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-gold/10 px-3 py-2 text-[11px] uppercase tracking-widest text-gold">
      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      Demo mode · changes are disabled
    </div>
  );
}
