import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  return {
    plugins: [react(), {
      name: 'exlaider-build-info',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ mode, emulators: mode === 'emulator' || env.VITE_FIREBASE_MODE === 'emulator', projectId: env.VITE_FIREBASE_PROJECT_ID || null }) })
      },
    }],
  }
})
