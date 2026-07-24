/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL?: string
  readonly VITE_ACCESS_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
