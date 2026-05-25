const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Market Intelligence",
  "Inventory", "Diamonds", "Gold & Metals", "Orders & Deals", "Clients & CRM",
  "Finances", "Payments", "POS System", "Crypto Wallet", "Converter Hub",
  "Reports & Analytics", "Marketing Suite", "Social & Inbox", "Calendar & Tasks",
  "Documents", "Settings",
];

export function Nav() {
  return (
    <nav className="w-52 shrink-0 space-y-0.5 overflow-y-auto bg-surface p-3" aria-label="Primary">
      {SECTIONS.map((s) => {
        const active = s === "Dashboard";
        return (
          <div
            key={s}
            aria-current={active ? "page" : undefined}
            className={`cursor-default rounded px-2 py-1.5 text-sm ${
              active ? "bg-gold/10 text-gold" : "text-text/70 hover:text-gold"
            }`}
          >
            {s}
          </div>
        );
      })}
    </nav>
  );
}
