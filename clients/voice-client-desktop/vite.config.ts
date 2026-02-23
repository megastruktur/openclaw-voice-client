import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
      },
      preload: {
        input: path.join(__dirname, 'src/main/preload.ts'),
      },
      renderer: {},
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/renderer/popup/index.html'),
        settings: path.resolve(__dirname, 'src/renderer/settings/index.html'),
      },
    },
  },
})
