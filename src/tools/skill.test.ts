import { describe, expect, test } from 'bun:test';
import { resolveSkillLinks } from './skill.js';

const doc = 'See [WACC](sector-wacc.md), [abs](/etc/x.md) and [web](https://example.com/a.md).';

describe('resolveSkillLinks', () => {
  test('CLI rewrites relative links to absolute paths for read_file', () => {
    expect(resolveSkillLinks(doc, '/srv/skills/dcf', false)).toBe(
      'See [WACC](/srv/skills/dcf/sector-wacc.md), [abs](/etc/x.md) and [web](https://example.com/a.md).',
    );
  });

  test('web mode leaves links untouched so no server path is exposed', () => {
    expect(resolveSkillLinks(doc, '/srv/skills/dcf', true)).toBe(doc);
  });
});
