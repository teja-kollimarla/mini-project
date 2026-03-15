'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { SidebarNav } from '@/components/sidebar-nav'
import { TopNav } from '@/components/top-nav'
import { useUser } from '@/context/user-context'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { userId, isReady } = useUser()

  useEffect(() => {
    if (isReady && !userId) {
      router.replace('/login')
    }
  }, [isReady, userId, router])

  if (!isReady || !userId) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <SidebarNav />
      <TopNav />
      <main className="ml-64 mt-20 p-6">
        {children}
      </main>
    </div>
  )
}
