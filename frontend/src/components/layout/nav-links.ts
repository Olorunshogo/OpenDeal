// === Types

export interface NavLink {
  href: string;
  label: string;
}

// === Data

export const PRIMARY_NAV: NavLink[] = [
  { href: "/market", label: "Market" },
  { href: "/deals", label: "My deals" },
  { href: "/deals/new", label: "New deal" },
  { href: "/mediator", label: "Mediator" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/deals") {
    return pathname === "/deals" || (pathname.startsWith("/deals/") && !pathname.startsWith("/deals/new"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
