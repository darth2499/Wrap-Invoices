import { DEMO } from '../config.js';
import { api as live } from './supabase.js';
import { api as demo } from './demo.js';
import { isDemoLink } from '../lib/publicFast.js';

export const api = DEMO ? demo : live;

/** The API for a client link: the live server for real links, the demo only for links made in the demo. */
export const publicApi = (token) => (isDemoLink(token) ? demo : live);
