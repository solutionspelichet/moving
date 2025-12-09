import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Remplacer 'votre-nom-de-repo' par le nom de votre projet GitHub
  // Exemple: si votre URL est github.com/Jean/demenagement, mettez '/demenagement/'
  base: '/votre-nom-de-repo/', 
})
