const SECTIONS = [
  "Dashboard", "Market Analysis", "Company Overview", "Clients", "Staff",
  "Work Orders", "Maintenance", "Calendar", "Financial Overview",
  "AI & Automation", "Security Center", "Settings",
];
export function Nav() {
  return (
    <nav className="w-48 shrink-0 space-y-1 bg-surface p-3" aria-label="Primary">
      {SECTIONS.map((s) => (
        <div key={s} className="cursor-default rounded px-2 py-1 text-sm text-text/70
          hover:text-gold">{s}</div>
      ))}
    </nav>
  );
}
