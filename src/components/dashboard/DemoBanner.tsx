import { isDemoMode } from "@/lib/demo/mode";

export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-gold/15 px-4 py-1 text-[11px] uppercase tracking-widest text-gold">
      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      Demo Mode · simulated data
    </div>
  );
}
