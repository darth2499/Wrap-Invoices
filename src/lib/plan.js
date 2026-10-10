// Plans: "user" can do everything except upload receipt files; "pro" (and the account owner) can.
// The server enforces this too; this only decides what the app shows.
import { DEMO } from '../config.js';

export const canUploadReceipts = (profile) => DEMO || !!profile?.is_admin || profile?.plan === 'pro';
