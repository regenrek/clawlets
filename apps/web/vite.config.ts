import path from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
      src: path.resolve(__dirname, 'src'),
    },
  },
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
  plugins: [
    tailwindcss(),
    Icons({
      compiler: 'jsx',
      jsx: 'react',
      autoInstall: false,
    }),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ],
})
