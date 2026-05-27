/** Public demo toggle. NEXT_PUBLIC_ so server + client read the same value. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
