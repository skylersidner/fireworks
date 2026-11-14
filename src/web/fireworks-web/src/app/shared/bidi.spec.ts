import { quoted } from '../features/designer/shared/save-copy';
import { FSI, PDI, isolate } from './bidi';
import { creationTitle } from './link-copy';

const RLO = String.fromCharCode(0x202e);

/** Boo C3 close-out: names in plain strings are isolated, quotes outside the isolate. */
describe('bidi isolation of names', () => {
  it('FSI and PDI are U+2068 and U+2069', () => {
    expect([FSI.charCodeAt(0), PDI.charCodeAt(0)]).toEqual([0x2068, 0x2069]);
    expect(isolate('a')).toBe('\u2068a\u2069');
  });

  it('an override in a name is closed before the closing quote', () => {
    expect(quoted(`${RLO}evil`)).toBe(`\u201c\u2068${RLO}evil\u2069\u201d`);
    expect(creationTitle(`${RLO}evil`)).toBe(`\u2068${RLO}evil\u2069 \u00b7 Fireworks Sandbox`);
  });
});
