import { isDevBuild, readBooleanEnv } from './BuildEnv';

export const ENABLE_DEV_MENU = readBooleanEnv('VITE_ENABLE_DEV_MENU') ?? isDevBuild();
export const ENABLE_DEBUG_LOGS = readBooleanEnv('VITE_DEBUG_LOGS') ?? isDevBuild();
