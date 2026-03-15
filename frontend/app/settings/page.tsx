'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { LogOut, Bell, Lock, User, Globe, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { DashboardLayout } from '@/components/dashboard-layout'
import { ThemeToggle } from '@/components/theme-toggle'
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser({ name: u.name, email: u.email, external_id: u.external_id }))
      .catch(() => setUser({ name: null, email: null, external_id: getUserId() || '' }))
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
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Account</h2>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  type="text"
                  placeholder="Your name"
                  defaultValue={user?.name ?? ''}
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  defaultValue={user?.email ?? ''}
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

              <Button className="w-full">Save Changes</Button>
            </div>
          </Card>
        </motion.div>

        {/* Preferences */}
        <motion.div variants={itemVariants}>
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Globe className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Preferences</h2>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">Dark Mode</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enable dark mode for better viewing experience
                  </p>
                </div>
                <ThemeToggle />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  <Label className="text-base">Notifications</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Get updates about video processing and new features
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  <Label className="text-base">Email Notifications</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Receive important updates via email
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  <Label className="text-base">Auto-save Chats</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Automatically save chat conversations
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Security */}
        <motion.div variants={itemVariants}>
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Lock className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Security</h2>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-base mb-2 block">Change Password</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Update your password to keep your account secure
                </p>
                <Button variant="outline">Change Password</Button>
              </div>

              <div className="pt-4 border-t border-border">
                <Label className="text-base mb-2 block">Two-Factor Authentication</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Add an extra layer of security to your account
                </p>
                <Button variant="outline">Enable 2FA</Button>
              </div>

              <div className="pt-4 border-t border-border">
                <Label className="text-base mb-2 block">Active Sessions</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  View and manage your active login sessions
                </p>
                <Button variant="outline">View Sessions</Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Billing */}
        <motion.div variants={itemVariants}>
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-6">Billing & Plan</h2>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm text-muted-foreground mb-2">Current Plan</p>
                <p className="text-lg font-semibold">Professional</p>
                <p className="text-sm text-muted-foreground mt-2">
                  $29/month • Renews on Feb 15, 2024
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline">Change Plan</Button>
                <Button variant="outline">View Invoice</Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Danger Zone */}
        <motion.div variants={itemVariants}>
          <Card className="p-6 border-destructive/50 bg-destructive/5">
            <h2 className="text-xl font-semibold mb-6 text-destructive">Danger Zone</h2>

            <div className="space-y-4">
              <div>
                <Label className="text-base mb-2 block text-destructive">Delete Account</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Delete Account
                </Button>
              </div>

              <div className="pt-4 border-t border-destructive/20">
                <Label className="text-base mb-2 block">Logout</Label>
                <p className="text-sm text-muted-foreground mb-4">
                  Sign out from your current session
                </p>
                <Button
                  variant="outline"
                  className="w-full gap-2 text-destructive hover:bg-destructive/10"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  )
}
