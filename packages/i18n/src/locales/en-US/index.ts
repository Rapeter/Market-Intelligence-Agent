import { common } from './common.ts';
import { navigation } from './navigation.ts';
import { settings } from './settings.ts';
import { errors } from './errors.ts';
import { research } from './research.ts';
import { diagnostics } from './diagnostics.ts';
import { agent } from './agent.ts';

/**
 * en-US resource bundle. Feature slices add their own namespace here (today,
 * discover, research, …) alongside the matching zh-CN entry.
 */
export const enUsResources = {
  common,
  navigation,
  settings,
  errors,
  research,
  diagnostics,
  agent,
};
