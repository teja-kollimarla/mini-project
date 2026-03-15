'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { 
  Upload, 
  Search as SearchIcon, 
  MessageCircle, 
  Scissors, 
  ArrowRight,
  Play,
  Github,
  Twitter,
  Linkedin,
  Mail
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

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
    transition: { duration: 0.8, ease: 'easeOut' },
  },
}

const featureCards = [
  {
    icon: Upload,
    title: 'Video Ingestion',
    description: 'Add YouTube videos or upload your own videos. Support for playlists and bulk uploads.',
  },
  {
    icon: SearchIcon,
    title: 'AI Semantic Search',
    description: 'Search inside your videos with natural language. Find exactly what you need instantly.',
  },
  {
    icon: MessageCircle,
    title: 'Chat with Videos',
    description: 'Ask questions about your video content. Get answers powered by AI.',
  },
  {
    icon: Scissors,
    title: 'Auto Clip Generation',
    description: 'Automatically generate clips from your videos. Share insights in seconds.',
  },
]

const howItWorks = [
  {
    step: 1,
    title: 'Add Your Videos',
    description: 'Upload from YouTube, custom files, or entire playlists',
  },
  {
    step: 2,
    title: 'AI Indexing',
    description: 'Our AI analyzes and indexes the content of your videos',
  },
  {
    step: 3,
    title: 'Search & Create',
    description: 'Ask questions and generate clips instantly',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <Link href="/" className="flex items-center gap-2">
              <Play className="h-6 w-6 text-primary" />
              <span className="text-xl font-bold">Videobase</span>
            </Link>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Link href="/login">
                <Button variant="outline">Sign In</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background gradient orb */}
        <div className="absolute top-20 right-20 w-96 h-96 bg-primary/20 rounded-full blur-3xl -z-10 animate-pulse" />
        <div className="absolute bottom-0 left-20 w-80 h-80 bg-accent/10 rounded-full blur-3xl -z-10" />

        <motion.div
          className="mx-auto max-w-4xl text-center"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground mb-6 text-balance"
            variants={itemVariants}
          >
            Search, Ask, and Clip Insights from Your Videos
          </motion.h1>

          <motion.p
            className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto text-balance"
            variants={itemVariants}
          >
            AI-powered video understanding that lets you explore knowledge inside your videos. Search semantically, chat with content, and generate clips automatically.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            variants={itemVariants}
          >
            <Link href="/login">
              <Button size="lg" className="gap-2">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" variant="outline" className="gap-2">
                <Play className="h-4 w-4" />
                Sign Up
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <motion.div
            className="text-center mb-16"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <h2 className="text-4xl font-bold mb-4">Powerful Features</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Everything you need to unlock insights from your video library
            </p>
          </motion.div>

          <motion.div
            className="grid md:grid-cols-2 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {featureCards.map((feature, index) => {
              const Icon = feature.icon
              return (
                <motion.div
                  key={index}
                  className="group rounded-xl border border-border bg-card p-8 hover:border-accent/50 hover:bg-card/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10"
                  variants={itemVariants}
                  whileHover={{ y: -5 }}
                >
                  <Icon className="h-8 w-8 text-primary mb-4 group-hover:text-accent transition-colors" />
                  <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-card/30">
        <div className="mx-auto max-w-6xl">
          <motion.div
            className="text-center mb-16"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <h2 className="text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-xl text-muted-foreground">
              Get started in three simple steps
            </p>
          </motion.div>

          <motion.div
            className="grid md:grid-cols-3 gap-8"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {howItWorks.map((item, index) => (
              <motion.div key={index} className="relative" variants={itemVariants}>
                <div className="rounded-lg border border-border bg-background p-8 text-center relative z-10">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold mx-auto mb-4">
                    {item.step}
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
                {index < howItWorks.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-0.5 bg-gradient-to-r from-border to-transparent" />
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <motion.div
            className="text-center mb-16"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <h2 className="text-4xl font-bold mb-4">Trusted by Teams</h2>
            <p className="text-xl text-muted-foreground">
              Used by content creators and enterprises worldwide
            </p>
          </motion.div>

          <motion.div
            className="grid md:grid-cols-3 gap-6"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            {[
              {
                name: 'Sarah Chen',
                role: 'Content Creator',
                quote: 'Videobase saves me hours searching through recordings. Game changer for content repurposing.',
                initials: 'SC',
              },
              {
                name: 'Alex Rodriguez',
                role: 'Product Manager',
                quote: 'Finally, a tool that understands video content. Our team uses it daily for research and insights.',
                initials: 'AR',
              },
              {
                name: 'Jordan Kim',
                role: 'Educator',
                quote: 'Students love being able to search and clip lecture videos. Makes learning more interactive.',
                initials: 'JK',
              },
            ].map((testimonial, index) => (
              <motion.div
                key={index}
                className="rounded-lg border border-border bg-card p-6"
                variants={itemVariants}
                whileHover={{ y: -2 }}
              >
                <p className="text-muted-foreground mb-4 italic">{`"${testimonial.quote}"`}</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center font-semibold text-sm text-primary">
                    {testimonial.initials}
                  </div>
                  <div>
                    <p className="font-semibold">{testimonial.name}</p>
                    <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-primary/10 via-background to-accent/10">
        <motion.div
          className="mx-auto max-w-3xl text-center"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.h2
            className="text-4xl font-bold mb-6"
            variants={itemVariants}
          >
            Start Building Your Video Knowledge Base
          </motion.h2>

          <motion.p
            className="text-xl text-muted-foreground mb-8"
            variants={itemVariants}
          >
            Join teams already using Videobase to unlock insights from their video content.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            variants={itemVariants}
          >
            <Link href="/login">
              <Button size="lg" className="gap-2">
                Get Started Now
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/register">
            <Button size="lg" variant="outline">
              Sign Up
            </Button>
          </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 px-4 sm:px-6 lg:px-8 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Play className="h-5 w-5 text-primary" />
                <span className="font-bold">Videobase</span>
              </div>
              <p className="text-sm text-muted-foreground">
                AI-powered video understanding for everyone.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition">Features</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Pricing</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Security</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition">Docs</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Blog</Link></li>
                <li><Link href="#" className="hover:text-foreground transition">Support</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <div className="flex gap-3">
                <Button variant="ghost" size="icon"><Twitter className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><Github className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><Linkedin className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><Mail className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
          <div className="border-t border-border pt-8 flex flex-col sm:flex-row justify-between items-center">
            <p className="text-sm text-muted-foreground">
              © 2024 Videobase. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm text-muted-foreground mt-4 sm:mt-0">
              <Link href="#" className="hover:text-foreground transition">Privacy</Link>
              <Link href="#" className="hover:text-foreground transition">Terms</Link>
              <Link href="#" className="hover:text-foreground transition">Cookies</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
