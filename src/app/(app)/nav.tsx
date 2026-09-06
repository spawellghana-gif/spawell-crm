"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/types";

const NAV: { group: string; items: [string, string, AppRole[]][] }[] = [
  {
    group: "Operate",
    items: [
      ["/", "Dashboard", ["owner", "officer", "therapist"]],
      ["/enquiries", "Enquiries", ["owner", "officer"]],
      ["/bookings", "Bookings", ["owner", "officer", "therapist"]],
      ["/tasks", "Tasks", ["owner", "officer", "therapist"]],
    ],
  },
  {
    group: "Records",
    items: [
      ["/clients", "Clients", ["owner", "officer"]],
      ["/partners", "Partners", ["owner", "officer"]],
      ["/therapists", "Therapists", ["owner", "officer"]],
      ["/services", "Services", ["owner", "officer"]],
    ],
  },
  {
    group: "Business",
    items: [["/finance", "Finance", ["owner", "officer"]]],
  },
  {
    group: "System",
    items: [["/settings", "Settings", ["owner"]]],
  },
];

const MOBILE: [string, string][] = [
  ["/", "Home"], ["/enquiries", "Enquiries"], ["/bookings", "Bookings"], ["/tasks", "Tasks"],
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Rail({ role, name }: { role: AppRole; name: string }) {
  const pathname = usePathname();
  return (
    <nav className="rail" aria-label="Main">
      <div className="brand">
        <span className="mark">SW</span>
        <div>
          <h1>SpaWell CRM</h1>
          <small>Accra operations</small>
        </div>
      </div>
      {NAV.map((section) => {
        const items = section.items.filter(([, , roles]) => roles.includes(role));
        if (!items.length) return null;
        return (
          <div className="navgroup" key={section.group}>
            <span>{section.group}</span>
            {items.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`navlink ${isActive(pathname, href) ? "on" : ""}`}
                aria-current={isActive(pathname, href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </div>
        );
      })}
      <div className="railfoot">
        Signed in as <b style={{ color: "var(--ink)" }}>{name}</b>
        <br />
        {role === "owner" ? "Owner/Admin" : role === "officer" ? "Booking Officer" : "Therapist"}
        <form action="/auth/signout" method="post" style={{ marginTop: 8 }}>
          <button className="btn sm" type="submit">Sign out</button>
        </form>
      </div>
    </nav>
  );
}

export function MobileNav({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = MOBILE.filter(([href]) =>
    role === "therapist" ? href === "/" || href === "/bookings" || href === "/tasks" : true,
  );
  return (
    <nav className="mobnav" aria-label="Sections">
      {items.map(([href, label]) => (
        <Link key={href} href={href} className={isActive(pathname, href) ? "on" : ""}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
