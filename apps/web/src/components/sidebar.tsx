'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { statsApi, DashboardStats } from '@/lib/api';
import {
  LayoutDashboard,
  User,
  Wand2,
  Video,
  Layers,
  FolderOpen,
  Image,
  Music,
  FileText,
  Settings,
  ChevronDown,
  ChevronRight,
  Sparkles,
  DollarSign,
} from 'lucide-react';

// Main navigation items
const toolsNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'LoRA Creator', href: '/lora', icon: User },
  { name: 'Character Diagrams', href: '/characters', icon: Wand2 },
  { name: 'AI Swapper', href: '/swap', icon: Video },
  { name: 'Variant Generator', href: '/variants', icon: Layers },
];

// Resources submenu items
const resourcesNavigation = [
  { name: 'Videos', href: '/library/videos', icon: Video },
  { name: 'Audios', href: '/library/audios', icon: Music },
  { name: 'Hooks', href: '/library/hooks', icon: FileText },
  { name: 'Images', href: '/library/images', icon: Image },
  { name: 'Models', href: '/library/models', icon: Sparkles },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const [resourcesExpanded, setResourcesExpanded] = useState(true);
  const [costs, setCosts] = useState<{ today: number; thisMonth: number } | null>(null);

  // Check if any resource route is active
  const isResourceActive = resourcesNavigation.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  // Load costs on mount and refresh periodically
  useEffect(() => {
    const loadCosts = async () => {
      try {
        const stats = await statsApi.getDashboardStats();
        setCosts({
          today: stats.costs.today,
          thisMonth: stats.costs.thisMonth,
        });
      } catch (error) {
        console.error('Failed to load costs:', error);
      }
    };

    loadCosts();
    const interval = setInterval(loadCosts, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            N
          </div>
          <span className="font-semibold text-lg">NOVAI</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
        {/* Tools Section */}
        <div className="pb-2">
          <span className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tools
          </span>
        </div>
        {toolsNavigation.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}

        {/* Library Section */}
        <div className="pt-4 pb-2">
          <span className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Library
          </span>
        </div>

        {/* My Projects */}
        <Link
          href="/projects"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            pathname === '/projects' || pathname.startsWith('/projects/')
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <FolderOpen className="h-4 w-4" />
          My Projects
        </Link>

        {/* Resources (Collapsible) */}
        <button
          onClick={() => setResourcesExpanded(!resourcesExpanded)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            isResourceActive && !resourcesExpanded
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {resourcesExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Resources
        </button>

        {/* Resources Submenu */}
        {resourcesExpanded && (
          <div className="ml-4 space-y-1 border-l border-border pl-2">
            {resourcesNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      {/* Credits Display */}
      {costs && (
        <div className="border-t p-3">
          <Link href="/credits" className="block">
            <div className="rounded-lg bg-muted p-3 hover:bg-muted/80 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-green-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Credits
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Today</span>
                  <span className="font-medium">{formatCents(costs.today)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">This Month</span>
                  <span className="font-medium">{formatCents(costs.thisMonth)}</span>
                </div>
              </div>
            </div>
          </Link>
        </div>
      )}

      <div className="border-t p-2">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}
