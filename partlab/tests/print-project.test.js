import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintProject, defaultFilaments, makeSupportFin, orcaPaintCode } from '../print-project.js';

const faces = new Float32Array([
  0,0,0, 0,0,1, 0,1,0,
  0,0,0, 1,0,0, 0,0,1,
  0,0,0, 0,1,0, 1,0,0,
  0,0,1, 1,0,0, 0,1,0
]);

test('color export joins fused patches into one indexed part and preserves eight custom filament colors', () => {
  const filaments = ['#1a2b3c', '#334455', '#887766', '#fedcba', '#aabbcc', '#0f3355', '#72bb40', '#e35f21'];
  const { files, warnings } = buildPrintProject({ name: 'Test', parts: [
    { name: 'Lower', positions: faces.slice(0, 18) },
    { name: 'Upper', positions: faces.slice(18), slot: 7 }
  ], filaments, scale: 22, origin: [0, 0, 0], fused: true });
  const model = files['3D/3dmodel.model'];
  assert.deepEqual(warnings, { open: 0, irregular: 0, removed: 0 });
  assert.equal([...model.matchAll(/<vertex /g)].length, 4);
  assert.deepEqual([...model.matchAll(/<m:color color="([^"]+)"/g)].map(match => match[1]), filaments.map(color => color.toUpperCase()));
  assert.match(model, /p1="7" p2="7" p3="7" paint_color="5C"/);
  assert.equal([...model.matchAll(/p1="0" p2="0" p3="0" paint_color="4"/g)].length, 2);
  assert.deepEqual(JSON.parse(files['Metadata/project_settings.config']).filament_colour, filaments.map(color => color.toUpperCase()));
});

test('the print project rejects a ninth filament slot', () => {
  assert.equal(defaultFilaments.length, 8);
  const parts = [{ name: 'Model', positions: faces, slot: 0 }];
  assert.throws(() => buildPrintProject({
    name: 'Test', parts, filaments: [...defaultFilaments, '#000000'], scale: 1, origin: [0, 0, 0]
  }), /at most 8 filament slots/);
  assert.throws(() => buildPrintProject({
    name: 'Test', parts: [{ ...parts[0], slot: 8 }], filaments: defaultFilaments, scale: 1, origin: [0, 0, 0]
  }), /missing filament slot/);
});

test('geometry of a bed-mounted support fin is watertight and leaves the requested gap', () => {
  const fin = makeSupportFin({ anchor: [4, 3, 36], bed: 2, scale: .5, angle: Math.PI / 3, footprint: 12, thickness: 1.2, gap: .25 });
  const z = [...fin.positions].filter((_, index) => index % 3 === 2);
  assert.equal(Math.min(...z), 2);
  assert.equal((36 - Math.max(...z)) * .5, .25);
  const { files, warnings } = buildPrintProject({ name: 'Supported model', parts: [{ name: 'Model', positions: faces, slot: 0 }],
    fins: [{ ...fin, name: 'Support fin 1', slot: 1 }], filaments: ['#FFFFFF','#663300'], scale: .5, origin: [4, 3, 2], fused: false });
  assert.deepEqual(warnings, { open: 0, irregular: 0, removed: 0 });
  assert.match(files['3D/3dmodel.model'], /name="Support fin 1"/);
  assert.match(files['3D/3dmodel.model'], /<component objectid="3"\/>/);
});

test('3MF colors remain possible beyond the Orca-specific paint codes', () => {
  assert.equal(orcaPaintCode(0), '4');
  assert.equal(orcaPaintCode(1), '8');
  assert.equal(orcaPaintCode(16), 'EC');
  assert.equal(orcaPaintCode(31), 'EFC');
  assert.equal(orcaPaintCode(32), '');
});
