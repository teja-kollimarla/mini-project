'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { LogOut, User, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DashboardLayout } from '@/components/dashboard-layout'
import { getCurrentUser, getUserId, logout } from '@/lib/api'
import { useRouter } from 'next/navigation'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
}

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ name: string | null; email: string | null; external_id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser({ name: u.name, email: u.email, external_id: u.external_id }))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load account details')
        setUser({ name: null, email: null, external_id: getUserId() || '' })
      })
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <motion.div
        className="max-w-2xl space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your account</p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Account</h2>
            </div>

            {error && <p className="text-sm text-destructive mb-4">{error}</p>}

            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  type="text"
                  placeholder="Your name"
                  value={user?.name ?? ''}
                  readOnly
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={user?.email ?? ''}
                  readOnly
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-2">
                <Label>User ID</Label>
                <Input
                  type="text"
                  value={user?.external_id ?? ''}
                  disabled
                  className="bg-background border-border"
                />
              </div>

              <Button
                variant="outline"
                className="w-full gap-2 text-destructive hover:bg-destructive/10"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  )
}
