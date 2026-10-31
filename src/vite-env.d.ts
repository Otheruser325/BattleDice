interface ImportMetaEnv {
  readonly VITE_ENABLE_DEV_MENU?: string;
  readonly VITE_DEBUG_LOGS?: string;
  readonly VITE_RIVALIS_WS_URL?: string;
  readonly VITE_RIVALIS_TICKET_ENDPOINT?: string;
  readonly VITE_RIVALIS_IDENTITY_ENDPOINT?: string;
  readonly VITE_RIVALIS_RECONNECT_MAX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
