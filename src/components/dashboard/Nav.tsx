import { AiyaLogo } from "./AiyaLogo";
import { LogoutButton } from "./LogoutButton";

const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Market Intelligence",
  "Inventory", "Diamonds", "Gold & Metals", "Orders & Deals", "Clients & CRM",
  "Finances", "Payments", "POS System", "Crypto Wallet", "Converter Hub",
  "Reports & Analytics", "Marketing Suite", "Social & Inbox", "Calendar & Tasks",
  "Documents", "Settings",
];

export function Nav() {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      {/* Brand identity */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <AiyaLogo size={34} />
        <div className="leading-tight">
          <div className="text-foil font-display text-xl font-semibold tracking-[0.22em]">
            AIYA
          </div>
          <div className="text-[9px] uppercase tracking-[0.28em] text-text/40">Designs</div>
        </div>
      </div>

      {/* Account chip */}
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs text-text/80">AIYA Designs HQ</div>
        <div className="text-[10px] uppercase tracking-wider text-gold/80">
          Super Administrator
        </div>
        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[9px] text-ok">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Verified Member
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Primary">
        {SECTIONS.map((s) => {
          const active = s === "Dashboard";
          return (
            <div
              key={s}
              aria-current={active ? "page" : undefined}
              className={`flex cursor-default items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border border-gold/30 bg-gold/10 text-gold"
                  : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${active ? "bg-gold" : "bg-text/20"}`} />
              {s}
            </div>
          );
        })}
      </nav>

      {/* Elite membership card */}
      <div className="mx-3 mb-3 rounded-xl border border-gold/25 bg-gradient-to-b from-gold/10 to-transparent p-3">
        <div className="flex items-center gap-2">
          <AiyaLogo size={18} />
          <span className="text-foil font-display text-sm font-semibold tracking-widest">
            AIYA ELITE
          </span>
        </div>
        <div className="mt-1 text-[10px] text-text/50">VIP Membership · Active</div>
      </div>

      {/* Market status */}
      <div className="mx-3 mb-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text/45">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
          </span>
          Market Status
        </div>
        <div className="mt-0.5 text-[11px] text-ok">All Systems Operational</div>
      </div>

      <div className="px-3 pb-4">
        <LogoutButton />
      </div>
    </aside>
  );
}
