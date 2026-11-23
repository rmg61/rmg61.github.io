import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintProject, defaultFilaments, makeSupportFin, orcaPaintCode } from '../print-project.js';
import { buildRegionSolids } from '../region-solids.js';

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
  ], filaments, scale: 22, origin: [0, 0, 0], fused: true, separateRegions: false });
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
  assert.match(files['3D/3dmodel.model'], /<build><item objectid="2" printable="1"\/><item objectid="3" printable="1"\/><\/build>/);
  assert.match(files['Metadata/model_settings.config'], /<object id="3" auto_drop="0"><metadata key="name" value="Support fin 1"\/><metadata key="extruder" value="2"\/>/);
});

test('tall support fins widen at the bed while keeping the same narrow contact', () => {
  const options = { bed: 0, scale: 1, angle: 0, footprint: 12, thickness: 1.2, gap: .25 };
  const short = makeSupportFin({ ...options, anchor: [0, 0, 20.25] });
  const tall = makeSupportFin({ ...options, anchor: [0, 0, 80.25] });
  assert.equal(short.footLength, 12);
  assert.equal(tall.footLength, 38.4);
  function widthAt(fin, zMin) {
    const x = [...fin.positions].filter((_, index) => index % 3 === 0 && fin.positions[index + 2] >= zMin);
    return Math.max(...x) - Math.min(...x);
  }
  assert.equal(widthAt(short, 20), widthAt(tall, 80));
  assert.ok(widthAt(tall, 0) > widthAt(tall, 80) * 10);
  const result = buildPrintProject({
    name: 'Tall fin', parts: [{ name: 'Fin', ...tall }], filaments: defaultFilaments, scale: 1, origin: [0, 0, 0]
  });
  assert.deepEqual(result.warnings, { open: 0, irregular: 0, removed: 0 });
});

test('separate fused regions are closed bodies with distinct build items and filament assignments', () => {
  const result = buildPrintProject({ name: 'Separated tetrahedron', parts: [
    { name: 'Lower', positions: faces.slice(0, 18) },
    { name: 'Upper', positions: faces.slice(18), slot: 2 }
  ], filaments: defaultFilaments, scale: 4, origin: [0, 0, 0], fused: true });
  const model = result.files['3D/3dmodel.model'];
  assert.equal(result.objectCount, 2);
  assert.equal(result.pitch, .35);
  assert.deepEqual(result.warnings, { open: 0, irregular: 0, removed: 0 });
  assert.match(model, /<build><item objectid="2" printable="1"\/><item objectid="3" printable="1"\/><\/build>/);
  assert.match(result.files['Metadata/model_settings.config'], /id="3" auto_drop="0"><metadata key="name" value="Upper"\/><metadata key="extruder" value="3"\/>/);
  for (const mesh of model.matchAll(/<triangles>(.*?)<\/triangles>/g)) {
    const edges = new Map();
    for (const [, ...corners] of mesh[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
      corners.forEach((a, index) => {
        const b = corners[(index + 1) % 3];
        const key = [a, b].sort().join(',');
        const tally = edges.get(key) ?? [0, 0];
        tally[0]++;
        tally[1] += a < b ? 1 : -1;
        edges.set(key, tally);
      });
    }
    assert.ok(edges.size > 0);
    assert.ok([...edges.values()].every(([count, direction]) => count === 2 && direction === 0));
  }
});

test('a common 3MF plate transform centers all parts without changing their spacing', () => {
  const parts = [
    { name: 'Left', positions: faces },
    { name: 'Right', positions: faces.map((value, axis) => value + (axis % 3 === 0 ? 3 : 0)), slot: 2 }
  ];
  const makeProject = (originAtCenter, groupObjects = false) => buildPrintProject({
    name: 'Test', parts, filaments: defaultFilaments, scale: 2, origin: [-1, -2, -4], groupObjects,
    plate: { width: 220, depth: 180, originAtCenter }
  });
  const separate = makeProject(false);
  assert.equal(separate.fitsPlate, true);
  assert.deepEqual([...separate.files['3D/3dmodel.model'].matchAll(/<item [^>]*transform="([^"]+)"/g)].map(match => match[1]), [
    '1 0 0 0 1 0 0 0 1 104 85 -8', '1 0 0 0 1 0 0 0 1 104 85 -8'
  ]);
  const grouped = makeProject(true, true);
  assert.equal(grouped.assembled, true);
  assert.match(grouped.files['3D/3dmodel.model'], /<build><item objectid="4" transform="1 0 0 0 1 0 0 0 1 -6 -5 -8"/);
  assert.match(grouped.files['Metadata/model_settings.config'], /<part id="3" subtype="normal_part"><metadata key="name" value="Right"\/><metadata key="extruder" value="3"\/>/);
  assert.deepEqual(JSON.parse(grouped.files['Metadata/project_settings.config']).printable_area, ['-110x-90', '110x-90', '110x90', '-110x90']);
});

test('solid remeshing projects the slanted surface off the axis-aligned grid', () => {
  const { bodies, pitch } = buildRegionSolids([{ name: 'Tetrahedron', positions: faces }], 4, [0, 0, 0]);
  const candidates = bodies[0].vertices.filter(point => point.every(value => value > .5) &&
    point.reduce((sum, value) => sum + value, 0) > 3.5);
  assert.ok(candidates.length >= 5);
  for (const point of candidates) {
    const distance = Math.abs(4 - point.reduce((sum, value) => sum + value, 0));
    assert.ok(distance < pitch * .25, `Off-plane vertex: ${point}`);
  }
});

test('3MF colors remain possible beyond the Orca-specific paint codes', () => {
  assert.equal(orcaPaintCode(0), '4');
  assert.equal(orcaPaintCode(1), '8');
  assert.equal(orcaPaintCode(16), 'EC');
  assert.equal(orcaPaintCode(31), 'EFC');
  assert.equal(orcaPaintCode(32), '');
});
