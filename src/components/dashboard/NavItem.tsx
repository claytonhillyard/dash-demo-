"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Single sidebar entry. Active-state computed from the current URL via
 * `usePathname()` rather than hardcoded so the gold highlight actually moves
 * as the user navigates. Used by `Nav.tsx`.
 *
 * Active rules:
 *   - Root href "/" matches the root path EXACTLY (otherwise "/" would prefix-
 *     match every route).
 *   - Any other href matches `pathname === href` OR `pathname` starts with
 *     `href + "/"` (so `/customers/123/edit` activates the Customers entry).
 *   - Items with no href (placeholders) are never active.
 */
export function NavItem({
  label,
  href,
}: {
  label: string;
  href?: string;
}) {
  const pathname = usePathname();
  const active = href
    ? href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/")
    : false;

  const className = `flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border border-gold/30 bg-gold/10 text-gold"
      : "border border-transparent text-text/65 hover:bg-surface-2 hover:text-gold"
  }`;
  const dot = (
    <span
      className={`h-1 w-1 rounded-full ${active ? "bg-gold" : "bg-text/20"}`}
    />
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {dot}
        {label}
      </Link>
    );
  }
  return (
    <div
      aria-current={active ? "page" : undefined}
      className={`${className} cursor-default`}
    >
      {dot}
      {label}
    </div>
  );
}
