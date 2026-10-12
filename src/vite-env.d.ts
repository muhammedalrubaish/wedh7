/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" turns off the browser-only demo banner once data is served by Supabase. */
  readonly VITE_DEMO?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
