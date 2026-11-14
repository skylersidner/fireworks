import { PRESETS } from '../../../../engine/model/presets';
import { MemoryStorage } from '../../../testing/memory-storage';
import {
  DRAFT_KEY,
  editableFrom,
  readDraft,
  readSource,
  serializeDraft,
  type DesignerDraft,
} from './designer-draft';
import type { CreationSource } from '../../../core/creation-save';

function stored(text: string): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(DRAFT_KEY, text);
  return storage;
}

function draft(overrides: Partial<DesignerDraft> = {}): DesignerDraft {
  return {
    shell: editableFrom(PRESETS[9]),
    activeBreak: 2,
    display: { mode: 'show' as const, persistence: 0.5, starBudget: 0.6, reduceFlashing: true },
    shellDirty: true,
    skyDirty: true,
    saved: false,
    source: null,
    ...overrides,
  };
}

describe('designer draft (acceptance 2c.9–2c.12)', () => {
  it('round-trips shell, sky, tab, display and both dirty flags', () => {
    const d = draft();
    d.shell.sky = { gravity: 300, wind: -10 };
    expect(readDraft(stored(serializeDraft(d)))).toEqual(d);
  });

  it('no key, or storage that throws, reads as no draft', () => {
    expect(readDraft(new MemoryStorage())).toBeNull();
    expect(readDraft(null)).toBeNull();
    const throwing = stored(serializeDraft(draft()));
    throwing.failReads = true;
    expect(readDraft(throwing)).toBeNull();
  });

  it.each([
    ['non-JSON text', 'not json {'],
    ['null', 'null'],
    ['an array', '[]'],
    ['{}', '{}'],
    ['a bare ShellDocument (no envelope)', JSON.stringify(PRESETS[0])],
    ['a future shell version', JSON.stringify({ shell: { ...PRESETS[0], version: 2 } })],
    [
      'an unknown pattern',
      JSON.stringify({ shell: { ...PRESETS[0], breaks: [{ pattern: 'willow' }] } }),
    ],
    ['five breaks', JSON.stringify({ shell: { ...PRESETS[0], breaks: [{}, {}, {}, {}, {}] } })],
  ])('falls back silently on %s', (_name, text) => {
    expect(readDraft(stored(text))).toBeNull();
  });

  it('clamps an out-of-range value instead of discarding the draft', () => {
    const d = draft();
    (d.shell.breaks[0] as { stars: number }).stars = 9999;
    expect(readDraft(stored(serializeDraft(d)))?.shell.breaks[0].stars).toBe(400);
  });

  it('bad display fields and tab fall back one by one, keeping the shell', () => {
    const text = JSON.stringify({
      shell: PRESETS[9],
      activeBreak: 7,
      display: { mode: 'timeline', persistence: 9, starBudget: 'x', reduceFlashing: 'yes' },
    });
    const d = readDraft(stored(text))!;
    expect(d.shell.name).toBe('Triple Break');
    expect(d.activeBreak).toBe(2);
    expect(d.display).toEqual({
      mode: 'loop',
      persistence: 0.92,
      starBudget: 1,
      reduceFlashing: null,
    });
  });

  it.each([
    ['clean', { shellDirty: false, skyDirty: false }],
    ['shell-dirty only', { shellDirty: true, skyDirty: false }],
    ['sky-dirty only', { shellDirty: false, skyDirty: true }],
  ])('round-trips a %s draft', (_name, flags) => {
    const d = draft(flags);
    expect(readDraft(stored(serializeDraft(d)))).toEqual(d);
  });

  const CLEAN = { shellDirty: false, skyDirty: false };

  it.each(['shellDirty', 'skyDirty'] as const)('each flag is read on its own: %s', (key) => {
    const text = JSON.stringify({ ...JSON.parse(serializeDraft(draft(CLEAN))), [key]: true });
    const d = readDraft(stored(text))!;
    expect(d.shellDirty).toBe(key === 'shellDirty');
    expect(d.skyDirty).toBe(key === 'skyDirty');
  });

  it.each([
    ['a string', 'false'],
    ['a number', 0],
    ['null', null],
    ['an object', {}],
  ])('a %s flag reads as dirty (fails safe, 2c.11)', (_name, value) => {
    for (const key of ['shellDirty', 'skyDirty'] as const) {
      const text = JSON.stringify({ ...JSON.parse(serializeDraft(draft(CLEAN))), [key]: value });
      expect(readDraft(stored(text))?.[key]).toBe(true);
    }
  });

  it.each([
    ['true', true, true],
    ['false', false, false],
    ['missing', undefined, true],
    ['a string', 'false', true],
  ])('a pre-split draft with dirty %s reads both flags from it', (_name, dirty, expected) => {
    const { shellDirty: _a, skyDirty: _b, ...rest } = JSON.parse(serializeDraft(draft(CLEAN)));
    const d = readDraft(stored(JSON.stringify({ ...rest, dirty })))!;
    expect(d.shellDirty).toBe(expected);
    expect(d.skyDirty).toBe(expected);
  });

  it('a new flag wins over a stale legacy dirty', () => {
    const text = JSON.stringify({ ...JSON.parse(serializeDraft(draft(CLEAN))), dirty: true });
    expect(readDraft(stored(text))).toMatchObject(CLEAN);
  });

  it('a pre-ruling draft (baseline, no flags) restores, ignores baseline, and reads dirty', () => {
    const { shellDirty: _a, skyDirty: _b, ...rest } = JSON.parse(serializeDraft(draft(CLEAN)));
    const text = JSON.stringify({ ...rest, baseline: { ...rest } });
    const d = readDraft(stored(text))!;
    expect(d.shell.name).toBe('Triple Break');
    expect(d).toMatchObject({ shellDirty: true, skyDirty: true });
    expect(Object.keys(d)).toEqual([
      'shell',
      'activeBreak',
      'display',
      'shellDirty',
      'skyDirty',
      'saved',
      'source',
    ]);
  });

  it('a draft shell without sky restores with the default sky', () => {
    const d = readDraft(stored(JSON.stringify({ shell: PRESETS[0] })))!;
    expect(d.shell.sky).toEqual({ gravity: 160, wind: 0 });
  });

  it('serializes with a fixed key order, sky before breaks (plan §3.3)', () => {
    const text = serializeDraft(draft());
    expect(Object.keys(JSON.parse(text))).toEqual([
      'shell',
      'activeBreak',
      'display',
      'shellDirty',
      'skyDirty',
      'saved',
      'source',
    ]);
    expect(Object.keys(JSON.parse(text).shell)).toEqual([
      'version',
      'name',
      'burstHeight',
      'angleJitter',
      'sky',
      'breaks',
    ]);
  });
});

describe('designer draft source (Phase 5; schema.md §11.2)', () => {
  const SOURCE: CreationSource = {
    shareCode: 'Ab3dEf7h',
    kind: 'shell',
    isOwner: true,
    updatedAt: '2026-11-13T21:20:26.65593+00:00',
    name: 'Willow 2',
  };

  it('round-trips a working copy source exactly, updatedAt as the same string', () => {
    const d = draft({ source: SOURCE });
    const restored = readDraft(stored(serializeDraft(d)))!;
    expect(restored).toEqual(d);
    expect(restored.source?.updatedAt).toBe(SOURCE.updatedAt);
  });

  it('serializes source fields in a fixed order and nothing else from the object', () => {
    const extra = { ...SOURCE, remixedFrom: 'Zz9yXw8v', document: {} } as CreationSource;
    const text = serializeDraft(draft({ source: extra }));
    expect(Object.keys(JSON.parse(text).source)).toEqual([
      'shareCode',
      'kind',
      'isOwner',
      'updatedAt',
      'name',
    ]);
  });

  it('an old draft with no source restores as fresh work, shell and flags kept', () => {
    const { source: _s, ...rest } = JSON.parse(serializeDraft(draft({ shellDirty: false })));
    const d = readDraft(stored(JSON.stringify(rest)))!;
    expect(d.source).toBeNull();
    expect(d.shell.name).toBe('Triple Break');
    expect(d).toMatchObject({ shellDirty: false, skyDirty: true, activeBreak: 2 });
  });

  it.each([
    ['null', null],
    ['a string', 'Ab3dEf7h'],
    ['an array', [SOURCE]],
    ['a malformed share code (l)', { ...SOURCE, shareCode: 'abcdefgl' }],
    ['a 9-character share code', { ...SOURCE, shareCode: 'Ab3dEf7hJ' }],
    ['an unknown kind', { ...SOURCE, kind: 'Shell' }],
    ['a string isOwner', { ...SOURCE, isOwner: 'true' }],
    ['a missing isOwner', { shareCode: SOURCE.shareCode, kind: 'shell', updatedAt: 'x' }],
    ['an empty updatedAt', { ...SOURCE, updatedAt: '' }],
    ['a numeric updatedAt', { ...SOURCE, updatedAt: 1763068826 }],
    ['a 10 KB updatedAt (Boo C6)', { ...SOURCE, updatedAt: 'x'.repeat(10_240) }],
    ['kind admin (Boo C6)', { ...SOURCE, kind: 'admin' }],
    [
      'kind show in a shell draft (a tampered draft; Boo, Phase 5 info)',
      { ...SOURCE, kind: 'show' },
    ],
    ['a missing name (schema.md §11.2: all-or-nothing)', { ...SOURCE, name: undefined }],
    ['a numeric name', { ...SOURCE, name: 7 }],
    ['an over-long name', { ...SOURCE, name: 'n'.repeat(161) }],
  ])('a source that is %s reads as null without discarding the shell', (_name, source) => {
    const text = JSON.stringify({ ...JSON.parse(serializeDraft(draft())), source });
    const d = readDraft(stored(text))!;
    expect(d.shell.name).toBe('Triple Break');
    expect(d.source).toBeNull();
  });

  it('readSource keeps exactly the five fields, for the kind asked for only', () => {
    expect(readSource({ ...SOURCE, extra: 1 }, 'shell')).toEqual(SOURCE);
    expect(readSource({ ...SOURCE, kind: 'show', isOwner: false }, 'show')).toEqual({
      ...SOURCE,
      kind: 'show',
      isOwner: false,
    });
    expect(readSource({ ...SOURCE, kind: 'show' }, 'shell')).toBeNull();
    expect(readSource(SOURCE, 'show')).toBeNull();
  });
});
