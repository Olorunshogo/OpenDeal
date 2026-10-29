"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ApiStatusIndicator } from "@/components/ApiStatusBanner";
import { HeaderIdentity } from "@/components/HeaderIdentity";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { menuVariants, transitionFast } from "@/lib/motion";
import { AppLogo } from "./AppLogo";
import { PRIMARY_NAV, isActivePath } from "./nav-links";

// === Types

export interface SiteHeaderProps {
  transparent?: boolean;
}

// === Component

export function SiteHeader({ transparent = false }: SiteHeaderProps): React.JSX.Element {
  const pathname: string = usePathname();
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [menuPath, setMenuPath] = useState<string>(pathname);

  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b backdrop-blur-xl",
        transparent ? "border-transparent bg-canvas/30" : "border-line bg-canvas/70",
      )}
    >
      <div className="flex items-center justify-between gap-6 px-4 py-3.5 sm:px-6 lg:px-12">
        <AppLogo />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((link) => {
            const active: boolean = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm transition-colors",
                  active ? "bg-glass text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <ApiStatusIndicator />
          <span className="hidden sm:inline-flex">
            <HeaderIdentity />
          </span>
          <IconButton
            label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="site-mobile-menu"
            icon={menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            onClick={() => setMenuOpen((open) => !open)}
            className="lg:hidden"
          />
        </div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.nav
            id="site-mobile-menu"
            aria-label="Primary"
            variants={menuVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitionFast}
            className="flex flex-col gap-1 border-t border-line px-4 py-3 sm:px-6 lg:hidden"
          >
            {PRIMARY_NAV.map((link) => {
              const active: boolean = isActivePath(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-sm transition-colors",
                    active ? "bg-glass text-ink" : "text-ink-muted hover:bg-glass hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <span className="flex px-3 py-2.5 text-sm text-ink-muted sm:hidden">
              <HeaderIdentity />
            </span>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
