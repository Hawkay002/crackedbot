import { DEFAULT_RUBRIC, type PresetName, type Rubric, rubricSchema } from './rubric.js';

interface PresetDef {
  description: string;
  weights: Rubric['weights'];
  requireLanguagesAnyOf: string[];
  entryTier?: string;
}

export const PRESETS: Record<PresetName, PresetDef> = {
  general: {
    description: 'Balanced. Good default for any engineering community.',
    weights: { consistency: 20, impact: 20, collaboration: 20, craft: 20, community: 10, depth: 10 },
    requireLanguagesAnyOf: [],
  },
  systems: {
    description: 'Low-level and infra. Values craft, depth, and upstream collaboration over popularity.',
    weights: { consistency: 20, impact: 10, collaboration: 25, craft: 25, community: 5, depth: 15 },
    requireLanguagesAnyOf: ['C', 'C++', 'Rust', 'Zig', 'Go', 'Assembly', 'Nix'],
  },
  web: {
    description: 'Frontend and full stack. Values shipping, impact, and consistency.',
    weights: { consistency: 25, impact: 25, collaboration: 15, craft: 20, community: 10, depth: 5 },
    requireLanguagesAnyOf: [
      'TypeScript',
      'JavaScript',
      'HTML',
      'CSS',
      'Svelte',
      'Vue',
      'Astro',
      'PHP',
      'Ruby',
    ],
  },
  ml: {
    description: 'ML and data. Values depth and collaboration; notebooks count as work.',
    weights: { consistency: 20, impact: 20, collaboration: 20, craft: 15, community: 10, depth: 15 },
    requireLanguagesAnyOf: ['Python', 'Jupyter Notebook', 'Julia', 'R', 'C++', 'CUDA'],
  },
  mobile: {
    description: 'iOS, Android, cross-platform. Values craft and shipping cadence.',
    weights: { consistency: 25, impact: 20, collaboration: 15, craft: 25, community: 5, depth: 10 },
    requireLanguagesAnyOf: ['Swift', 'Kotlin', 'Dart', 'Java', 'Objective-C', 'TypeScript', 'C#'],
  },
  gamedev: {
    description: 'Game and engine work. Values craft and depth; popularity matters less.',
    weights: { consistency: 20, impact: 15, collaboration: 15, craft: 30, community: 5, depth: 15 },
    requireLanguagesAnyOf: ['C++', 'C#', 'GDScript', 'Rust', 'Lua', 'C', 'TypeScript', 'JavaScript'],
  },
  hackathon: {
    description: 'Low bar, high energy. Admits anyone who has actually pushed code recently.',
    weights: { consistency: 35, impact: 10, collaboration: 10, craft: 20, community: 5, depth: 20 },
    requireLanguagesAnyOf: [],
    entryTier: 'Tourist',
  },
};

export function applyPreset(base: Rubric, name: PresetName): Rubric {
  const p = PRESETS[name];
  return rubricSchema.parse({
    ...base,
    preset: name,
    weights: p.weights,
    entryTier: p.entryTier ?? base.entryTier,
    gates: { ...base.gates, requireLanguagesAnyOf: p.requireLanguagesAnyOf },
  });
}

export function presetRubric(name: PresetName): Rubric {
  return applyPreset(DEFAULT_RUBRIC, name);
}
