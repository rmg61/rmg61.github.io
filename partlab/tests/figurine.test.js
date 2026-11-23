import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { bounds, splitConnected } from '../geometry.js';
import { makeFigurine } from '../figurine-sample.js';
import { findFigurineParts } from '../figurine-parts.js';

const figurine = makeFigurine();
const tolerance = Math.hypot(...bounds(figurine).size) * 1e-8;

test('a one-piece figurine yields six connected regions with every triangle accounted for', () => {
  assert.equal(splitConnected(figurine, tolerance).length, 1);
  const regions = findFigurineParts(figurine);
  assert.deepEqual(regions.map(region => region.name), ['Head', 'Torso', 'Arm A', 'Arm B', 'Leg A', 'Leg B']);
  const sourceTriangles = new Set();
  for (let i = 0; i < figurine.length; i += 9) sourceTriangles.add(String(figurine.subarray(i, i + 9)));
  for (const { positions } of regions) {
    assert.equal(splitConnected(positions, tolerance).length, 1);
    for (let i = 0; i < positions.length; i += 9) assert.ok(sourceTriangles.delete(String(positions.subarray(i, i + 9))));
  }
  assert.equal(sourceTriangles.size, 0);
});

test('discovery splits a dominant figurine and retains detached fragments', async (t) => {
  const workerModule = new URL('../parts-worker.js', import.meta.url);
  const bridge = `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: (...args) => parentPort.postMessage(...args) };
    await import(${JSON.stringify(workerModule.href)});
    parentPort.on('message', data => self.onmessage({ data }));
  `;
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bridge)));
  t.after(() => worker.terminate());
  const fragment = new Float32Array([10, 10, 10, 11, 10, 10, 10, 11, 10]);
  const positions = new Float32Array(figurine.length + fragment.length);
  positions.set(figurine);
  positions.set(fragment, figurine.length);
  const response = once(worker, 'message');
  worker.postMessage({ sources: [{ name: 'Figurine', positions }], infer: true });
  const [result] = await response;
  assert.equal(result.segmentation, 'figurine');
  assert.equal(result.parts.filter(part => part.inferred).length, 6);
  assert.deepEqual(result.parts.at(-1).positions, fragment);
  assert.equal(result.parts.reduce((total, part) => total + part.positions.length, 0), positions.length);
});

test('landmarks follow a rotated and translated figurine that is Y-up', () => {
  const transformed = figurine.slice();
  for (let i = 0; i < figurine.length; i += 3) {
    const [x, y, z] = figurine.subarray(i, i + 3);
    transformed.set([x * .8 + y * .6 + 15, z - 20, x * .6 - y * .8 + 11], i);
  }
  const regions = findFigurineParts(transformed);
  assert.equal(regions?.length, 6);
  assert.ok(bounds(regions[0].positions).center[1] > bounds(regions[1].positions).center[1]);
});

test('a one-piece shape without limbs stays unsplit', () => {
  const triangles = [];
  for (let i = 0; i < 64; i++) {
    const a = i * Math.PI / 32;
    const b = ((i + 1) % 64) * Math.PI / 32;
    const lowA = [Math.cos(a), Math.sin(a), 0];
    const lowB = [Math.cos(b), Math.sin(b), 0];
    const highA = [...lowA.slice(0, 2), 5];
    const highB = [...lowB.slice(0, 2), 5];
    triangles.push(...lowA, ...lowB, ...highA, ...highA, ...lowB, ...highB, 0, 0, 0, ...lowB, ...lowA, 0, 0, 5, ...highA, ...highB);
  }
  assert.equal(findFigurineParts(new Float32Array(triangles)), null);
});
