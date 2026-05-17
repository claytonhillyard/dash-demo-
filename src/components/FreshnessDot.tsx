export type Freshness = "live" | "delayed" | "stale" | "simulated";

const COLOR: Record<Freshness, string> = {
  live: "bg-ok",
  delayed: "bg-warn",
  stale: "bg-bad/60",
  simulated: "bg-transparent ring-1 ring-text/50",
};

export function FreshnessDot({ freshness }: { freshness: Freshness }) {
  return (
    <span
      data-testid="freshness-dot"
      data-freshness={freshness}
      title={freshness}
      className={`inline-block h-2 w-2 rounded-full ${COLOR[freshness]}`}
    />
  );
}
