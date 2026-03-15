'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Home, 
  Upload, 
  Search, 
  Scissors, 
  MessageCircle, 
  Film, 
  Settings,
  LogOut,
  Play
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/ingest', label: 'Ingest', icon: Upload },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/clips', label: 'Clips', icon: Scissors },
  { href: '/chats', label: 'Chats', icon: MessageCircle },
  { href: '/videos', label: 'My Videos', icon: Film },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-sidebar">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-6">
          <Play className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-sidebar-foreground">Videobase</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-6">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start gap-3',
                    isActive && 'bg-sidebar-accent text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Button>
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-sidebar-border p-4">
          <Button 
            variant="outline" 
            className="w-full justify-start gap-3 text-destructive hover:bg-destructive/10"
            onClick={() => window.location.href = '/'}
          >
            <LogOut className="h-5 w-5" />
            <span>Logout</span>
          </Button>
        </div>
      </div>
    </aside>
  )
}
