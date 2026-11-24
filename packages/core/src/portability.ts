import { type FlowConfig, migrateConfig } from './config';

export const EXPORT_KIND = 'flow-personalization';

/** Everything the user tuned, and nothing device- or secret-related (no hotkey, mic, key, models). */
export interface PersonalizationExport {
  kind: typeof EXPORT_KIND;
  version: 1;
  dictionary: FlowConfig['dictionary'];
  appTones: FlowConfig['appTones'];
  defaultTone: FlowConfig['defaultTone'];
  cleanupLevel: FlowConfig['cleanupLevel'];
  snippets: FlowConfig['snippets'];
  style: string;
}

export function exportPersonalization(c: FlowConfig): PersonalizationExport {
  return {
    kind: EXPORT_KIND,
    version: 1,
    dictionary: c.dictionary,
    appTones: c.appTones,
    defaultTone: c.defaultTone,
    cleanupLevel: c.cleanupLevel,
    snippets: c.snippets,
    style: c.style,
  };
}

/** Replaces the personalization parts of `current`, validating everything. Throws on a foreign file. */
export function importPersonalization(current: FlowConfig, raw: unknown): FlowConfig {
  if (typeof raw !== 'object' || raw === null || (raw as { kind?: unknown }).kind !== EXPORT_KIND)
    throw new Error('This is not a Flow personalization export.');
  const r = raw as Partial<PersonalizationExport>;
  return migrateConfig({
    ...current,
    dictionary: r.dictionary,
    appTones: r.appTones,
    defaultTone: r.defaultTone,
    cleanupLevel: r.cleanupLevel ?? current.cleanupLevel,
    snippets: r.snippets,
    style: r.style,
  });
}
