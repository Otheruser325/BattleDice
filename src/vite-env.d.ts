/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_MENU?: string;
  readonly VITE_DEBUG_LOGS?: string;
  readonly VITE_RIVALIS_WS_URL?: string;
  readonly VITE_RIVALIS_TICKET?: string;
  readonly VITE_RIVALIS_TICKET_SOURCE?: 'query' | 'protocol';
  readonly VITE_RIVALIS_RECONNECT_MAX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
