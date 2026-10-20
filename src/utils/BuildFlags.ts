import { BUILD_ENV, isDevBuild, readBooleanEnv } from './BuildEnv';

const devMenuRequested = readBooleanEnv('VITE_ENABLE_DEV_MENU') ?? isDevBuild();

// Defense in depth: the Dev menu grants unlimited currency and dice copies, so it must stay
// unreachable in a production bundle even if the flag slips past the build-time CI guards.
export const DEV_MENU_AVAILABLE = devMenuRequested && BUILD_ENV.PROD !== true;
export const ENABLE_DEV_MENU = DEV_MENU_AVAILABLE;
export const ENABLE_DEBUG_LOGS = readBooleanEnv('VITE_DEBUG_LOGS') ?? isDevBuild();
