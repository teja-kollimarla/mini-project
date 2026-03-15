'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  BarChart3,
  Scissors,
  MessageCircle,
  Upload,
  Search,
  Zap,
  Play,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Card } from '@/components/ui/card'
import { listVideos, listChunks, listChats } from '@/lib/api'

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

const quickActions = [
  {
    title: 'Add Videos',
    description: 'Ingest new videos from YouTube or upload custom files',
    icon: Upload,
    href: '/ingest',
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
  },
  {
    title: 'Ask a Question',
    description: 'Search and chat with your video content',
    icon: Search,
    href: '/search',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  {
    title: 'Create Clip',
    description: 'Generate clips from your videos instantly',
    icon: Scissors,
    href: '/clips',
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
  },
]

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour(s) ago`
  if (diffDays < 7) return `${diffDays} day(s) ago`
  return date.toLocaleDateString()
}

export default function DashboardPage() {
  const [videos, setVideos] = useState<Array<{ id: string; filename: string; source: string; created_at: string }>>([])
  const [chunks, setChunks] = useState<Array<{ id: string; document_name: string; filename: string; created_at: string }>>([])
  const [chats, setChats] = useState<Array<{ id: string; title: string | null; updated_at: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([listVideos(), listChunks(), listChats()])
      .then(([vRes, cRes, chRes]) => {
        setVideos(vRes)
        setChunks(cRes.chunks ?? [])
        setChats(chRes)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const videoCount = videos.length
  const chunkCount = chunks.length
  const chatCount = chats.length

  type ActivityItem = {
    type: 'video' | 'clip' | 'chat'
    title: string
    subtitle: string
    timestamp: string
    href: string
    icon: typeof Play
  }
  const recentActivity: ActivityItem[] = [
    ...videos.slice(0, 3).map((v) => ({
      type: 'video' as const,
      title: v.filename,
      subtitle: v.source === 'youtube' ? 'YouTube' : 'Upload',
      timestamp: v.created_at,
      href: '/videos',
      icon: Play,
    })),
    ...chunks.slice(0, 3).map((c) => ({
      type: 'clip' as const,
      title: c.document_name,
      subtitle: 'Clip',
      timestamp: c.created_at,
      href: '/clips',
      icon: Scissors,
    })),
    ...chats.slice(0, 3).map((ch) => ({
      type: 'chat' as const,
      title: ch.title || 'Chat',
      subtitle: 'Conversation',
      timestamp: ch.updated_at,
      href: `/chats/${ch.id}`,
      icon: MessageCircle,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5)

  const statCards = [
    { label: 'Videos Indexed', value: String(videoCount), icon: BarChart3, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
    { label: 'Clips Created', value: String(chunkCount), icon: Scissors, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
    { label: 'Chats', value: String(chatCount), icon: MessageCircle, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10' },
  ]

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading dashboard...</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <motion.div
        className="space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
          <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your video library</p>
        </motion.div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <motion.div className="grid md:grid-cols-3 gap-6" variants={containerVariants}>
          {statCards.map((stat, index) => {
            const Icon = stat.icon
            return (
              <motion.div key={index} variants={itemVariants} whileHover={{ y: -4 }}>
                <Card className="p-6 hover:border-primary/50 transition-all duration-300">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                      <Icon className={`h-6 w-6 ${stat.color}`} />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold">{stat.value}</p>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>

        <motion.div variants={itemVariants}>
          <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {quickActions.map((action, index) => {
              const Icon = action.icon
              return (
                <motion.div key={index} whileHover={{ y: -4 }} variants={itemVariants}>
                  <Link href={action.href}>
                    <Card className="p-6 hover:border-primary/50 transition-all duration-300 cursor-pointer h-full">
                      <div className={`p-3 rounded-lg ${action.bgColor} w-fit mb-4`}>
                        <Icon className={`h-6 w-6 ${action.color}`} />
                      </div>
                      <h3 className="font-semibold mb-2">{action.title}</h3>
                      <p className="text-sm text-muted-foreground">{action.description}</p>
                    </Card>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </motion.div>

        {recentActivity.length > 0 && (
          <motion.div variants={itemVariants}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Recent Activity</h2>
              <Link href="/videos">
                <Button variant="outline" size="sm">View All</Button>
              </Link>
            </div>
            <Card className="divide-y divide-border">
              {recentActivity.map((activity, index) => {
                const Icon = activity.icon
                return (
                  <motion.div
                    key={`${activity.type}-${index}-${activity.title}`}
                    className="flex items-center justify-between p-4 hover:bg-card/50 transition-colors"
                    whileHover={{ x: 4 }}
                    variants={itemVariants}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-muted">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium line-clamp-1">{activity.title}</p>
                        <p className="text-sm text-muted-foreground">{activity.subtitle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(activity.timestamp)}</span>
                      <Link href={activity.href}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Play className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </motion.div>
                )
              })}
            </Card>
          </motion.div>
        )}

        {videoCount === 0 && (
          <motion.div
            className="rounded-lg border border-border/50 bg-card/30 p-6 text-center"
            variants={itemVariants}
          >
            <div className="flex justify-center mb-4">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Get Started</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload your first video to start exploring AI-powered video insights
            </p>
            <Link href="/ingest">
              <Button size="sm" className="gap-2">
                <Upload className="h-4 w-4" />
                Add Videos
              </Button>
            </Link>
          </motion.div>
        )}
      </motion.div>
    </DashboardLayout>
  )
}
