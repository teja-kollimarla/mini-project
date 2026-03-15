'use client'

import { ThemeProvider } from 'next-themes'
import { UserProvider } from '@/context/user-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <UserProvider>
        {children}
      </UserProvider>
    </ThemeProvider>
  )
}
