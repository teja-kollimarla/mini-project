'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Play, Loader2, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { listVideos } from '@/lib/api'

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

type VideoRow = {
  id: string
  filename: string
  /** When set, Cloudinary playback URL; use as video src. */
  b2_key: string | null
  source: string
  source_url: string | null
  created_at: string
}

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listVideos()
      .then(setVideos)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load videos'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading videos...</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <motion.div
        className="max-w-6xl space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">My Videos</h1>
          <p className="text-muted-foreground">Manage and view all your indexed videos</p>
        </motion.div>

        {/* Table */}
        <motion.div variants={itemVariants}>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-card/50">
                    <th className="px-6 py-3 text-left text-sm font-semibold">Video Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Source</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Indexed Date</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Source URL</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((video) => (
                    <motion.tr
                      key={video.id}
                      className="border-b border-border hover:bg-card/50 transition-colors"
                      variants={itemVariants}
                      whileHover={{ x: 4 }}
                    >
                      <td className="px-6 py-4">
                        <p className="font-medium truncate max-w-xs">{video.filename}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {video.source}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {new Date(video.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground truncate max-w-[200px]">
                        {video.source_url || '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>View Details</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Grid View Alternative */}
        <motion.div variants={itemVariants}>
          <h2 className="text-lg font-semibold mb-4">Recent Uploads</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.slice(0, 6).map((video) => (
              <motion.div
                key={video.id}
                variants={itemVariants}
                whileHover={{ y: -4 }}
              >
                <Card className="overflow-hidden hover:border-primary/50 transition-all duration-300">
                  {/* Thumbnail Placeholder */}
                  <div className="relative w-full aspect-video bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center group cursor-pointer">
                    <Button
                      size="icon"
                      className="bg-primary/80 hover:bg-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Play className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold mb-2 truncate">{video.filename}</h3>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p>{video.source}</p>
                      <p className="text-xs">
                        {new Date(video.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  )
}
