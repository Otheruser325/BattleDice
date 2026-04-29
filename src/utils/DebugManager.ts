type DebugLevel = 'log' | 'warn' | 'error';

interface DebugRecord {
  at: string;
  level: DebugLevel;
  namespace: string;
  message: string;
  details: unknown[];
}

declare global {
  interface Window {
    __battleDiceDebug?: {
      enable: () => void;
      disable: () => void;
      dump: () => DebugRecord[];
      latest: () => DebugRecord | undefined;
    };
  }
}

const STORAGE_KEY = 'battle-dice-autoroller:debug';
const MAX_HISTORY = 250;

export class DebugManager {
  private static getMetaEnv(): { DEV?: boolean; MODE?: string } | undefined {
    const meta = import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } };
    return meta?.env;
  }

  private static enabled =
    !!this.getMetaEnv()?.DEV ||
    (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1');

  private static readonly history: DebugRecord[] = [];
  private static globalHooksInstalled = false;

  static installGlobalHooks() {
    if (typeof window === 'undefined' || this.globalHooksInstalled) {
      return;
    }

    this.globalHooksInstalled = true;

    window.addEventListener('error', (event) => {
      this.error('Window', event.message, event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      this.error('Promise', 'Unhandled rejection', event.reason);
    });

    window.__battleDiceDebug = {
      enable: () => this.setEnabled(true),
      disable: () => this.setEnabled(false),
      dump: () => this.snapshot(),
      latest: () => this.history[this.history.length - 1]
    };

    this.log('Debug', 'Global debug hooks installed.', {
      enabled: this.enabled,
      mode: this.getMetaEnv()?.MODE
    });
  }

  static setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    }

    this.log('Debug', enabled ? 'Debug logging enabled.' : 'Debug logging disabled.');
  }

  static scope(namespace: string) {
    return {
      log: (...details: unknown[]) => this.log(namespace, ...details),
      warn: (...details: unknown[]) => this.warn(namespace, ...details),
      error: (...details: unknown[]) => this.error(namespace, ...details),
      event: (message: string, payload?: unknown) => this.log(namespace, message, payload)
    };
  }

  static attachScene(sceneKey: string) {
    return this.scope(`Scene:${sceneKey}`);
  }

  static log(namespace: string, ...details: unknown[]) {
    this.write('log', namespace, details);
  }

  static warn(namespace: string, ...details: unknown[]) {
    this.write('warn', namespace, details);
  }

  static error(namespace: string, ...details: unknown[]) {
    this.write('error', namespace, details);
  }

  static snapshot(): DebugRecord[] {
    return [...this.history];
  }

  private static write(level: DebugLevel, namespace: string, details: unknown[]) {
    const [messageSource, ...rest] = details;
    const record: DebugRecord = {
      at: new Date().toISOString(),
      level,
      namespace,
      message: typeof messageSource === 'string' ? messageSource : JSON.stringify(messageSource ?? ''),
      details: typeof messageSource === 'string' ? rest : details
    };

    this.history.push(record);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    if (!this.enabled) {
      return;
    }

    const prefix = `[${record.namespace}]`;
    if (level === 'warn') {
      console.warn(prefix, record.message, ...record.details);
      return;
    }

    if (level === 'error') {
      console.error(prefix, record.message, ...record.details);
      return;
    }

    console.log(prefix, record.message, ...record.details);
  }
}
