'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Play, Loader2, ArrowRight, Sparkles, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { login as loginApi, setUserId, clearTokens } from '@/lib/api'

const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.12,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

const card = {
  hidden: { opacity: 0, scale: 0.96, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

const orbVariants = {
  animate: (i: number) => ({
    x: [0, 15, -10, 0],
    y: [0, -12, 8, 0],
    scale: [1, 1.05, 1, 1],
    transition: {
      duration: 8 + i * 2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  }),
}

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      await loginApi(email, password)
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGuestLogin = () => {
    clearTokens()
    setUserId(`guest_${crypto.randomUUID().replace(/-/g, '')}`)
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 overflow-hidden relative bg-gradient-to-br from-background via-background to-muted/30">
      {/* Animated background orbs */}
      <motion.div
        className="absolute top-20 right-20 w-[420px] h-[420px] rounded-full blur-3xl -z-10 bg-primary/25"
        variants={orbVariants}
        animate="animate"
        custom={0}
      />
      <motion.div
        className="absolute bottom-20 left-16 w-80 h-80 rounded-full blur-3xl -z-10 bg-accent/20"
        variants={orbVariants}
        animate="animate"
        custom={1}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl -z-10 bg-primary/10"
        variants={orbVariants}
        animate="animate"
        custom={2}
      />

      {/* Nav */}
      <motion.header
        className="fixed top-0 left-0 right-0 border-b border-border/40 bg-background/80 backdrop-blur-xl z-50"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto w-full">
          <Link href="/" className="flex items-center gap-2 group">
            <motion.span whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }}>
              <Play className="h-6 w-6 text-primary" />
            </motion.span>
            <span className="text-xl font-bold">Videobase</span>
          </Link>
          <ThemeToggle />
        </div>
      </motion.header>

      {/* Main card */}
      <motion.div
        className="w-full max-w-md"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          className="rounded-2xl border border-border bg-card/70 backdrop-blur-md p-8 shadow-2xl shadow-black/5 dark:shadow-black/20"
          variants={card}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="text-center mb-8" variants={item}>
            <motion.div
              className="inline-flex items-center gap-1.5 text-primary mb-3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Sparkles className="h-4 w-4" />
              <span className="text-sm font-medium">Video RAG</span>
            </motion.div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground">Sign in to search and chat with your videos</p>
          </motion.div>

          {error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <motion.form
            onSubmit={handleLogin}
            className="space-y-4"
            variants={container}
            initial="hidden"
            animate="visible"
          >
            <motion.div className="space-y-2" variants={item}>
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-background/80 border-border transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                disabled={isLoading}
              />
            </motion.div>

            <motion.div className="space-y-2" variants={item}>
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
               
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-background/80 border-border pr-10 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setShowPassword((p) => !p)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </motion.div>

            <motion.div variants={item}>
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                <Button
                  type="submit"
                  className="w-full gap-2 mt-2 h-11 font-medium"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </motion.div>
            </motion.div>
          </motion.form>

          

          

          <motion.p
            className="mt-6 text-center text-sm text-muted-foreground"
            variants={item}
            initial="hidden"
            animate="visible"
          >
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </motion.p>
        </motion.div>

      </motion.div>
    </div>
  )
}
