import Link from "next/link";
import { AiyaLogo } from "./AiyaLogo";
import { LogoutButton } from "./LogoutButton";

// Slice 5 §6.3 proposed mapping "Marketing Suite" → /website. The user (per
// slice-5 decision #1) preferred a dedicated "Website" entry alongside the
// other admin routes (Inventory, Diamonds, Orders & Deals) instead of
// repurposing the umbrella "Marketing Suite" slot. The standalone entry sits
// next to "Diamonds" so all owner-entered ledgers cluster together.
const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Circles", "Market Intelligence",
  "Inventory", "Diamonds", "Website", "Gold & Metals", "Orders & Deals",
  "Customers", "Clients & CRM", "Finances", "Payments", "POS System", "Crypto Wallet",
  "Converter Hub", "Reports & Analytics", "Marketing Suite", "Social & Inbox",
  "Calendar & Tasks", "Documents", "Settings",
];

const ROUTES: Record<string, string> = {
  Inventory: "/inventory",
  Diamonds: "/diamonds",
  Website: "/website",
  Circles: "/circles",
  "Orders & Deals": "/deals",
  "TradeNet Exchange": "/exchange",
  // Slice 22 — Customers is core (no module gating); the entry sits next to
  // Orders & Deals so all owner-entered ledgers cluster together. "Clients & CRM"
  // remains as a separate placeholder for the future contact-record + pipeline
  // surface that slice 22 explicitly does NOT cover.
  Customers: "/customers",
};

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
          const href = ROUTES[s];
          const className = `flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            active
              ? "border border-gold/30 bg-gold/10 text-gold"
              : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
          }`;
          const dot = <span className={`h-1 w-1 rounded-full ${active ? "bg-gold" : "bg-text/20"}`} />;
          if (href) {
            return (
              <Link key={s} href={href} className={className}>
                {dot}
                {s}
              </Link>
            );
          }
          return (
            <div key={s} aria-current={active ? "page" : undefined} className={`${className} cursor-default`}>
              {dot}
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
