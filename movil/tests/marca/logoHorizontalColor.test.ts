import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoHorizontalColor } from '../../assets/marca/logoHorizontalColor';

describe('logoHorizontalColor', () => {
  it('es el mismo SVG de marca/logo-horizontal-color.svg, sin cambios', () => {
    const original = readFileSync(join(__dirname, '../../../marca/logo-horizontal-color.svg'), 'utf8').trim();
    expect(logoHorizontalColor).toBe(original);
  });
});
