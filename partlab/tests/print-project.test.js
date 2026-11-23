import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintProject, makeSupportFin, orcaPaintCode } from '../print-project.js';

const faces = new Float32Array([
  0,0,0, 0,0,1, 0,1,0,
  0,0,0, 1,0,0, 0,0,1,
  0,0,0, 0,1,0, 1,0,0,
  0,0,1, 1,0,0, 0,1,0
]);

test('color export joins fused patches into one indexed part and preserves a 25-slot palette', () => {
  const filaments = Array.from({ length: 25 }, (_, i) => '#' + (i * 936487).toString(16).slice(-6).padStart(6, '0'));
  const { files, warnings } = buildPrintProject({ name: 'Test', parts: [
    { name: 'Lower', positions: faces.slice(0, 18), slot: 0 },
    { name: 'Upper', positions: faces.slice(18), slot: 24 }
  ], filaments, scale: 22, origin: [0, 0, 0], fused: true });
  const model = files['3D/3dmodel.model'];
  assert.deepEqual(warnings, { open: 0, irregular: 0, removed: 0 });
  assert.equal([...model.matchAll(/<vertex /g)].length, 4);
  assert.equal([...model.matchAll(/<m:color /g)].length, 25);
  assert.match(model, /p1="24" p2="24" p3="24" paint_color="7FC"/);
  assert.deepEqual(JSON.parse(files['Metadata/project_settings.config']).filament_colour, filaments.map(color => color.toUpperCase()));
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
