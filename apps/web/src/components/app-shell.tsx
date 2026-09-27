import { Activity, LayoutDashboard, Menu, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/tournaments', label: 'Tournaments', icon: <LayoutDashboard className="size-4" /> },
  { to: '/players', label: 'Players', icon: <Users className="size-4" /> },
  { to: '/teams', label: 'Teams', icon: <Users className="size-4" /> },
  { to: '/status', label: 'Status', icon: <Activity className="size-4" /> },
];

/**
 * Application shell: header, primary navigation and page content.
 *
 * On mobile the navigation collapses into a toggleable panel; on larger screens
 * it is a persistent sidebar. Links are real anchors so they are keyboard
 * navigable and announce their destination.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <NavLink to="/tournaments" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-bold"
            >
              B
            </span>
            <span className="leading-tight">
              <span className="block text-base font-semibold sm:text-lg">
                Badminton Tournament Manager
              </span>
              <span className="text-muted-foreground block text-xs">Tournament setup</span>
            </span>
          </NavLink>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-expanded={navOpen}
            aria-controls="app-navigation"
            onClick={() => {
              setNavOpen((open) => !open);
            }}
          >
            {navOpen ? <X /> : <Menu />}
            <span className="sr-only">Toggle navigation</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <nav
          id="app-navigation"
          aria-label="Primary"
          className={cn(
            'border-b lg:w-56 lg:shrink-0 lg:border-r lg:border-b-0',
            navOpen ? 'block' : 'hidden lg:block',
          )}
        >
          <ul className="flex flex-col gap-1 p-2 lg:sticky lg:top-0">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => {
                    setNavOpen(false);
                  }}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      <footer className="border-t">
        <div className="text-muted-foreground px-4 py-4 text-xs sm:px-6">
          Phase 4 · Tournament setup UI
        </div>
      </footer>
    </div>
  );
}
