/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_MENU?: string;
  readonly VITE_DEBUG_LOGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
