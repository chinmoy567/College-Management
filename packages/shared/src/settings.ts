/** Single source of the Settings keys and their seeded defaults (docs/spec/01-database.md §4). */

export type GradeBand = { min: number; g: string };

export interface SettingDef {
  readonly key: string;
  readonly default: unknown;
}

/** Groq production model, Llama 70B-class, checked against console.groq.com/docs/models on 2026-11-14. */
export const DEFAULT_AI_MODEL = 'llama-3.3-70b-versatile';

export const SETTING_DEFAULTS = {
  attendance_threshold: 75,
  attendance_colours: { green: 75, orange: 60 },
  grading_scale: [
    { min: 80, g: 'A+' },
    { min: 70, g: 'A' },
    { min: 60, g: 'A-' },
    { min: 50, g: 'B' },
    { min: 40, g: 'C' },
    { min: 33, g: 'D' },
    { min: 0, g: 'F' },
  ] satisfies GradeBand[],
  ai_provider: 'groq',
  ai_model: DEFAULT_AI_MODEL,
  ai_daily_limit: 20,
  banned_words_enabled: false,
  pin_days: 7,
  email_daily_limit: 450,
  maintenance_window: null as null | { day: string; from: string; to: string },
  college_profile: {
    name: '',
    about: '',
    departments: [] as string[],
    contact: {},
    logoId: null as string | null,
    bannerId: null as string | null,
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];
