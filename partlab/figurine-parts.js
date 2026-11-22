import { bounds, normal } from './geometry.js';

const names = ['Head', 'Torso', 'Arm A', 'Arm B', 'Leg A', 'Leg B'];
const levels = Array.from({ length: 37 }, (_, index) => .063 + index * .024);
export const figurineTriangleLimit = 180_000;

// A slice returns closed contours and their areas, independently of mesh vertex density.
function sliceContours(positions, up, plane, tolerance) {
  const u = (up + 1) % 3;
  const v = (up + 2) % 3;
  const nodes = new Map();
  function addPoint(x, y) {
    const key = `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
    if (!nodes.has(key)) nodes.set(key, { x, y, neighbors: [] });
    return nodes.get(key);
  }

  for (let triangle = 0; triangle < positions.length; triangle += 9) {
    const intersections = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle + edge * 3;
      const b = triangle + ((edge + 1) % 3) * 3;
      const deltaA = positions[a + up] - plane;
      const deltaB = positions[b + up] - plane;
      if ((deltaA < 0) === (deltaB < 0)) continue;
      const t = deltaA / (deltaA - deltaB);
      intersections.push(addPoint(
        positions[a + u] + t * (positions[b + u] - positions[a + u]),
        positions[a + v] + t * (positions[b + v] - positions[a + v])
      ));
    }
    const [a, b] = intersections;
    if (!b || a === b) continue;
    a.neighbors.push(b);
    b.neighbors.push(a);
  }

  const contours = [];
  const seen = new Set();
  for (const start of nodes.values()) {
    if (seen.has(start)) continue;
    const contour = [];
    let current = start;
    let previous;
    while (current && !seen.has(current) && current.neighbors.length === 2) {
      contour.push(current);
      seen.add(current);
      const next = current.neighbors.find(node => node !== previous);
      previous = current;
      current = next;
    }
    if (current !== start || contour.length < 3) continue;
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      const cross = (a.x - start.x) * (b.y - start.y) - (b.x - start.x) * (a.y - start.y);
      twiceArea += cross;
      x += (a.x + b.x - 2 * start.x) * cross;
      y += (a.y + b.y - 2 * start.y) * cross;
    }
    if (Math.abs(twiceArea) <= tolerance * tolerance) continue;
    contours.push({ area: Math.abs(twiceArea / 2), x: start.x + x / (3 * twiceArea), y: start.y + y / (3 * twiceArea) });
  }
  const largest = contours.reduce((area, contour) => Math.max(area, contour.area), 0);
  return contours.filter(contour => contour.area >= largest * .09);
}

function findLandmarks(positions, box, up, tolerance) {
  const height = box.size[up];
  const slices = levels.map(level => ({
    level,
    contours: sliceContours(positions, up, box.min[up] + height * level, tolerance)
  }));
  const legSlices = slices.filter(({ level, contours }) => {
    if (level < .11 || level > .36 || contours.length !== 2) return false;
    const [a, b] = contours;
    return Math.min(a.area, b.area) > Math.max(a.area, b.area) * .48 && Math.hypot(a.x - b.x, a.y - b.y) > height * .075;
  });
  if (legSlices.length < 3) return null;
  const [legA, legB] = legSlices[Math.floor(legSlices.length / 2)].contours;
  const length = Math.hypot(legB.x - legA.x, legB.y - legA.y);
  const axisX = (legB.x - legA.x) / length;
  const axisY = (legB.y - legA.y) / length;
  const center = ((legA.x + legB.x) * axisX + (legA.y + legB.y) * axisY) / 2;
  const projection = ({ x, y }) => x * axisX + y * axisY - center;
  const order = (a, b) => projection(a) - projection(b);

  const armSlices = slices.filter(({ level, contours }) => {
    if (level < .39 || level > .72 || contours.length !== 3) return false;
    contours.sort(order);
    const [a, torso, b] = contours;
    return projection(a) < -height * .12 && projection(b) > height * .12 &&
      Math.abs(projection(torso)) < height * .08 && torso.area > Math.max(a.area, b.area) * 1.2 &&
      Math.min(a.area, b.area) > Math.max(a.area, b.area) * .32;
  });
  if (armSlices.length < 2) return null;

  const topTorso = armSlices.at(-1).level;
  const necks = slices.filter(({ level, contours }) => level > Math.max(topTorso + .06, .71) && level < .88 && contours.length === 1);
  const heads = slices.filter(({ level, contours }) => level > .81 && contours.length === 1);
  const neck = necks.sort((a, b) => a.contours[0].area - b.contours[0].area)
    .find(slice => Math.abs(projection(slice.contours[0])) < height * .09 && heads.some(head =>
      head.level > slice.level + .035 && head.contours[0].area > slice.contours[0].area * 1.35 &&
      Math.abs(projection(head.contours[0])) < height * .09));
  if (!neck) return null;

  const seedsByLevel = new Map();
  for (const slice of legSlices) {
    seedsByLevel.set(slice.level, slice.contours.sort(order).map((contour, index) => ({ ...contour, label: index + 4 })));
  }
  for (const slice of armSlices) {
    seedsByLevel.set(slice.level, slice.contours.map((contour, index) => ({ ...contour, label: [2, 1, 3][index] })));
  }
  return { neck: neck.level, seedsByLevel };
}

class DistanceQueue {
  items = [];

  push(item) {
    const items = this.items;
    let i = items.length;
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= item[0]) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = item;
  }

  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length === 0) return first;
    let i = 0;
    while (i * 2 + 1 < items.length) {
      let child = i * 2 + 1;
      if (child + 1 < items.length && items[child + 1][0] < items[child][0]) child++;
      if (items[child][0] >= last[0]) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return first;
  }
}

// Keep the largest patch of each region and fill any small islands from their neighbors.
function keepRegionsConnected(labels, neighbors) {
  const visited = new Uint8Array(labels.length);
  const component = new Int32Array(labels.length);
  const largest = Array.from({ length: names.length }, () => new Int32Array());
  for (let first = 0; first < labels.length; first++) {
    if (visited[first]) continue;
    const label = labels[first];
    component[0] = first;
    visited[first] = 1;
    let size = 1;
    for (let current = 0; current < size; current++) {
      const index = component[current] * 3;
      for (let side = 0; side < 3; side++) {
        const neighbor = neighbors[index + side];
        if (neighbor < 0 || visited[neighbor] || labels[neighbor] !== label) continue;
        visited[neighbor] = 1;
        component[size++] = neighbor;
      }
    }
    if (size > largest[label].length) largest[label] = component.slice(0, size);
  }

  labels.fill(-1);
  let total = 0;
  largest.forEach((triangles, label) => {
    for (const triangle of triangles) {
      labels[triangle] = label;
      component[total++] = triangle;
    }
  });
  for (let edge = 0; edge < total; edge++) {
    const triangle = component[edge];
    for (let side = 0; side < 3; side++) {
      const neighbor = neighbors[triangle * 3 + side];
      if (neighbor < 0 || labels[neighbor] >= 0) continue;
      labels[neighbor] = labels[triangle];
      component[total++] = neighbor;
    }
  }
}

// Grow from labelled cross sections along shared edges, preferring smooth surface paths.
function growRegions(positions, box, up, landmarks, tolerance) {
  const count = positions.length / 9;
  const height = box.size[up];
  const centers = new Float64Array(count * 3);
  const normals = new Float32Array(count * 3);
  const neighbors = new Int32Array(count * 3).fill(-1);
  const labels = new Int8Array(count).fill(-1);
  const distance = new Float64Array(count).fill(Infinity);
  const u = (up + 1) % 3;
  const v = (up + 2) % 3;
  const vertices = new Map();
  const edges = new Map();
  const queue = new DistanceQueue();

  for (let triangle = 0; triangle < count; triangle++) {
    const start = triangle * 9;
    const index = triangle * 3;
    const vertexIds = [];
    for (let axis = 0; axis < 3; axis++) {
      centers[index + axis] = (positions[start + axis] + positions[start + axis + 3] + positions[start + axis + 6]) / 3;
      const vertex = start + axis * 3;
      const key = `${Math.round(positions[vertex] / tolerance)},${Math.round(positions[vertex + 1] / tolerance)},${Math.round(positions[vertex + 2] / tolerance)}`;
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      vertexIds.push(vertices.get(key));
    }
    normals.set(normal(positions, start), index);
    for (let side = 0; side < 3; side++) {
      const a = vertexIds[side];
      const b = vertexIds[(side + 1) % 3];
      if (a === b) continue;
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const slot = edges.get(key);
      if (slot === undefined) edges.set(key, index + side);
      else if (neighbors[slot] < 0) {
        neighbors[slot] = triangle;
        neighbors[index + side] = Math.floor(slot / 3);
      }
    }

    const level = (centers[index + up] - box.min[up]) / height;
    if (level >= landmarks.neck) {
      labels[triangle] = 0;
      distance[triangle] = 0;
      continue;
    }
    const closestLevel = levels[Math.round((level - levels[0]) / .024)];
    const seeds = landmarks.seedsByLevel.get(closestLevel);
    if (!seeds) continue;
    let closest = Infinity;
    for (const seed of seeds) {
      const separation = Math.hypot(centers[index + u] - seed.x, centers[index + v] - seed.y);
      if (separation >= closest) continue;
      closest = separation;
      labels[triangle] = seed.label;
    }
    distance[triangle] = 0;
    queue.push([0, triangle]);
  }

  while (queue.items.length > 0) {
    const [cost, triangle] = queue.pop();
    if (cost !== distance[triangle]) continue;
    const index = triangle * 3;
    for (const neighbor of neighbors.subarray(index, index + 3)) {
      if (neighbor < 0 || distance[neighbor] === 0) continue;
      const j = neighbor * 3;
      const edgeDistance = Math.hypot(centers[index] - centers[j], centers[index + 1] - centers[j + 1], centers[index + 2] - centers[j + 2]);
      const alignment = Math.abs(normals[index] * normals[j] + normals[index + 1] * normals[j + 1] + normals[index + 2] * normals[j + 2]);
      const candidate = cost + edgeDistance * (1 + 2 * (1 - Math.min(1, alignment)));
      if (candidate >= distance[neighbor]) continue;
      distance[neighbor] = candidate;
      labels[neighbor] = labels[triangle];
      queue.push([candidate, neighbor]);
    }
  }

  if (labels.some(label => label < 0)) return null;
  keepRegionsConnected(labels, neighbors);
  if (labels.some(label => label < 0)) return null;
  const sizes = new Uint32Array(names.length);
  for (const label of labels) sizes[label]++;
  if (sizes.some(size => size < Math.max(8, count * .018))) return null;
  const parts = names.map((name, index) => ({ name, inferred: true, positions: new Float32Array(sizes[index] * 9) }));
  const offsets = new Uint32Array(names.length);
  labels.forEach((label, triangle) => {
    const start = triangle * 9;
    parts[label].positions.set(positions.subarray(start, start + 9), offsets[label]);
    offsets[label] += 9;
  });
  return parts;
}

export function findFigurineParts(positions) {
  const count = positions.length / 9;
  if (count < 160 || count > figurineTriangleLimit) return null;
  const box = bounds(positions);
  const diagonal = Math.hypot(...box.size);
  const tolerance = Math.max(1e-7, diagonal * 1e-8);
  const axes = [2, 1, 0].filter(axis => box.size[axis] >= Math.max(...box.size) * .8);
  for (const up of axes) {
    const landmarks = findLandmarks(positions, box, up, tolerance);
    if (!landmarks) continue;
    const parts = growRegions(positions, box, up, landmarks, tolerance);
    if (parts) return parts;
  }
  return null;
}
