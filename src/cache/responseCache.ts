import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BlendshapeWeights,
  MoodTag,
  TtsEngineId,
  VoiceSampleRecord,
} from '../types/monster';

export interface CachedPerformanceEntry {
  cacheKey: string;
  normalizedText: string;
  mood: MoodTag;
  voiceId: string;
  ttsEngine?: TtsEngineId;
  pcmFloat32: Float32Array;
  sampleRate: number;
  durationMs: number;
  /** Pre-solved 60 Hz 44-target ARKit blendshape frames */
  frames60Hz: BlendshapeWeights[];
  createdAt: number;
  hitCount: number;
}

interface MonsterHouseDB extends DBSchema {
  audioCache: {
    key: string;
    value: CachedPerformanceEntry;
    indexes: { 'by-created': number };
  };
  voiceSamples: {
    key: MoodTag;
    value: VoiceSampleRecord;
  };
}

const DB_NAME = 'monsterhouse-webgpu-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MonsterHouseDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MonsterHouseDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MonsterHouseDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('audioCache', { keyPath: 'cacheKey' });
        store.createIndex('by-created', 'createdAt');
        db.createObjectStore('voiceSamples', { keyPath: 'mood' });
      },
    });
  }
  return dbPromise;
}

export function makeCacheKey(text: string, mood: MoodTag, voiceId: string): string {
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${voiceId}::${mood}::${norm}`;
}

export async function lookupCachedPerformance(
  text: string,
  mood: MoodTag,
  voiceId: string,
): Promise<CachedPerformanceEntry | undefined> {
  try {
    const db = await getDb();
    const key = makeCacheKey(text, mood, voiceId);
    const entry = await db.get('audioCache', key);
    if (entry) {
      entry.hitCount += 1;
      await db.put('audioCache', entry);
    }
    return entry;
  } catch {
    return undefined;
  }
}

export async function saveCachedPerformance(entry: CachedPerformanceEntry): Promise<void> {
  try {
    const db = await getDb();
    await db.put('audioCache', entry);
  } catch {
    // Ignore IndexedDB quota/private-mode errors gracefully
  }
}

export async function listCachedPerformances(): Promise<CachedPerformanceEntry[]> {
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex('audioCache', 'by-created');
    return all.reverse();
  } catch {
    return [];
  }
}

export async function deleteCachedPerformance(cacheKey: string): Promise<void> {
  const db = await getDb();
  await db.delete('audioCache', cacheKey);
}

export async function clearAllCachedPerformances(): Promise<void> {
  const db = await getDb();
  await db.clear('audioCache');
}

export async function saveVoiceSample(sample: VoiceSampleRecord): Promise<void> {
  const db = await getDb();
  await db.put('voiceSamples', sample);
}

export async function getAllVoiceSamples(): Promise<Partial<Record<MoodTag, VoiceSampleRecord>>> {
  try {
    const db = await getDb();
    const list = await db.getAll('voiceSamples');
    const out: Partial<Record<MoodTag, VoiceSampleRecord>> = {};
    for (const item of list) {
      out[item.mood] = item;
    }
    return out;
  } catch {
    return {};
  }
}
