/** Which page hosts the stage: picks the failure copy (phase-7.md §10, §11). */
export type StageSurface = 'designer' | 'builder' | 'player';

/** Startup failure (no WebGL): `{error}` is the renderer's message (phase-7.md §10). */
export function startFailureText(surface: StageSurface, error: string): string {
  const head = `Fireworks can't start in this browser: ${error}.`;
  switch (surface) {
    case 'builder':
      return `${head} The controls still work, and your show is kept in this browser.`;
    case 'player':
      return `${head} You can still open a copy with Remix.`;
    default:
      return `${head} The controls still work, and your shell is kept in this browser.`;
  }
}

/** Shown 1 s into a context loss (phase-7.md §11). */
export const CONTEXT_LOST_NOTICE =
  "Graphics paused by the browser. Playback resumes when they're back.";

/** The failure block 10 s into a loss with no restore. Never carries a raw error (Y§1). */
export const CONTEXT_FAILED_HEAD =
  "Graphics stopped on this page, and the browser hasn't brought them back.";

export const CONTEXT_FAILED_LINE: Readonly<Record<StageSurface, string>> = {
  designer: 'Reload to start the fireworks again. Your shell is kept in this browser.',
  builder: 'Reload to start the preview again. Your show is kept in this browser.',
  player: 'Reload to play it again from the start.',
};

export const RELOAD_PAGE = 'Reload page';
