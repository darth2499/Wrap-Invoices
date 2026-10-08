import { DEMO } from '../config.js';
import { api as live } from './supabase.js';
import { api as demo } from './demo.js';

export const api = DEMO ? demo : live;
