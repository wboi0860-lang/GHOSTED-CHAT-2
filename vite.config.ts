import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rootDir = typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname;

  return {
    plugins: [react(), tailwindcss()],
    envPrefix: ['VITE_'],
    define: {
      'process.env.VITE_ADMOB_APP_ID': JSON.stringify(env.VITE_ADMOB_APP_ID || process.env.VITE_ADMOB_APP_ID || ''),
      'process.env.VITE_ADMOB_BANNER_ID': JSON.stringify(env.VITE_ADMOB_BANNER_ID || process.env.VITE_ADMOB_BANNER_ID || ''),
      'process.env.VITE_ADMOB_INTERSTITIAL_ID': JSON.stringify(env.VITE_ADMOB_INTERSTITIAL_ID || process.env.VITE_ADMOB_INTERSTITIAL_ID || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
        'react-native': path.resolve(rootDir, 'src/shims/react-native.js'),
        'react-native-maps': path.resolve(rootDir, 'src/shims/react-native-maps.js'),
        'react-native-google-mobile-ads': path.resolve(rootDir, 'src/shims/react-native-google-mobile-ads.js'),
        'react-native-iap': path.resolve(rootDir, 'src/shims/react-native-iap.js'),
        'react-native-webview': path.resolve(rootDir, 'src/shims/react-native-webview.js'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
