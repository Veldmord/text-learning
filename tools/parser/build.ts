// Полный цикл: content/* → Play. Используется CLI, scenes:suggest и тестами.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Play } from '../../src/engine/types';
import { parsePlay, type CharacterConfig, type Overrides, type ParseResult } from './parse';
import { buildActs, type SceneConfig } from './scenes';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CONTENT = resolve(ROOT, 'content');
export const SOURCE_FILE = resolve(CONTENT, 'raiskie-vrata.txt');
export const SNAPSHOT_FILE = resolve(import.meta.dirname, '__snapshots__/counts.json');
export const PLAY_ID = 'raiskie-vrata';

const readYaml = <T>(file: string, fallback: T): T =>
  existsSync(file) ? ((parseYaml(readFileSync(file, 'utf8')) as T | null) ?? fallback) : fallback;

export interface BuildResult {
  play: Play;
  parsed: ParseResult;
  errors: string[];
}

export function loadContent(dir = CONTENT) {
  return {
    source: readFileSync(resolve(dir, 'raiskie-vrata.txt'), 'utf8'),
    characters: readYaml<CharacterConfig[]>(resolve(dir, 'characters.yaml'), []),
    overrides: readYaml<Overrides>(resolve(dir, 'overrides.yaml'), {}),
    scenes: readYaml<SceneConfig[]>(resolve(dir, 'scenes.yaml'), []),
  };
}

export function buildPlay(content = loadContent()): BuildResult {
  const parsed = parsePlay(content.source, content.characters, content.overrides);
  const sceneConfig: SceneConfig[] = content.scenes.length
    ? content.scenes
    : parsed.acts.map((a) => ({ id: `a${a.n}s01`, title: a.title, from: a.itemIds[0] ?? '' }));
  const { acts, errors: sceneErrors } = buildActs(parsed.acts, parsed.items, sceneConfig);
  const play: Play = {
    id: PLAY_ID,
    title: parsed.title,
    author: parsed.author,
    subtitle: parsed.subtitle,
    preface: parsed.preface,
    sourceHash: parsed.sourceHash,
    characters: parsed.characters,
    items: parsed.items,
    acts,
  };
  return { play, parsed, errors: [...parsed.errors, ...sceneErrors] };
}
