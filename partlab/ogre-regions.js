import { bounds, normal } from './geometry.js';

const sourceTriangles = 1_199_610;
const sourceHash = '932edea28502aebabb34a5ec5b23053ca9f1756f551968795b8eaa1fdf9bf55a';

// The authored seams use the source STL's coordinate system.
export async function matchesOgreSTL(buffer) {
  if (buffer.byteLength !== 84 + sourceTriangles * 50 ||
      new DataView(buffer).getUint32(80, true) !== sourceTriangles) return false;
  if (!globalThis.crypto?.subtle) return false;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') === sourceHash;
}

const regions = [
  ['Display plinth', [0, 0, -2.05]], ['Rocky terrain', [0, 0, -1.35]],
  ['Right foot', [-.85, .45, -1.08]], ['Right shin wraps', [-.67, .37, -.68]],
  ['Left shin wraps', [.70, -.27, -.67]], ['Left foot', [.85, -.40, -1.08]],
  ['Right thigh', [-.62, .38, -.32]], ['Left thigh', [.69, -.24, -.28]],
  ['Hip garment', [0, .66, -.30]], ['Front loincloth', [0, -1.25, -.53]],
  ['Rear hanging cloth', [0, 1.18, -.51]], ['Right hip pouch', [-1.15, .30, -.25]],
  ['Left hip pouch', [1.15, .50, -.24]], ['Belt and sash', [.14, -.78, -.10]],
  ['Torso and harness', [0, 0, 0]], ['Head and facial hair', [0, -.38, 1.14]],
  ['Right shoulder armor', [-.72, .52, .96]], ['Right upper arm', [-.63, .55, .36]],
  ['Right spiked bracer', [-.99, .79, .42]], ['Right gripping hand', [-1.28, 1.0, .22]],
  ['Hammer stone head', [-1.83, -.38, .81]], ['Hammer haft', [-1.67, -.64, .08]],
  ['Left upper arm', [.72, .12, .46]], ['Left studded bracer', [1.14, -.37, .54]],
  ['Left open hand', [1.55, -.69, .63]]
];

function classify(x, y, z) {
  let region = 14;
  const ellipse = (cx, cy, cz, rx, ry, rz) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 < 1;

  if (z < 865 + .10 * (x - 110) - .035 * (y - 140)) region = 8;
  if (z > 858 + .10 * (x - 110) - .035 * (y - 140) && z < 936 - .03 * (x - 110) + .035 * (y - 130)) region = 13;
  if (x < 92 && z < 637 + .36 * (x + 10) + .13 * (y - 115)) region = 6;
  if (x >= 92 && z < 588 + .20 * (x - 190) + .16 * (y - 75)) region = 7;
  if (z > 280 && z < 760 && y < 26 + .018 * (z - 480) && x > 18 - .12 * (z - 420) && x < 219 + .08 * (z - 450)) region = 9;
  if (z > 285 && z < 700 && y > 219 + .11 * (z - 480) && x > -12 - .12 * (z - 400) && x < 230 + .05 * (z - 450)) region = 10;
  if (x < -61 && ellipse(-140, 155, 731, 125, 180, 109)) region = 11;
  if (x > 313 && ellipse(389, 153, 732, 126, 180, 112)) region = 12;

  const rightShinTop = 400 + .16 * (y - 270);
  const leftShinTop = 417 + .12 * (y - 75);
  const rightFootTop = 226 - .07 * (y - 330);
  const leftFootTop = 223 + .08 * (y - 60);
  if (z > 125 && z < rightShinTop && x < 40 && y > 100) region = 3;
  if (z > 125 && z < leftShinTop && x > 235 && y < 275) region = 4;
  if (z < 233) region = 1;
  if (z < 89 + .014 * (x - 150) + .008 * (y - 100)) region = 0;
  if (z > 135 && z < rightFootTop && ellipse(-205, 343, 179, 206, 190, 94)) region = 2;
  if (z >= rightFootTop - 2 && z < rightShinTop && x < 40 && y > 100) region = 3;
  if (z > 198 && z >= rightFootTop && ellipse(-190, 320, 222, 154, 146, 75)) region = 3;
  if (z > 133 && z < leftFootTop && ellipse(462, 32, 176, 167, 208, 93)) region = 5;
  if (z >= leftFootTop && z < leftShinTop && x > 235 && y < 275) region = 4;

  if (z > 1180 && x > 6 - .18 * (z - 1250) && x < 214 + .065 * (z - 1250) && y < -99 + .50 * (z - 1300)) region = 15;
  if (z > 1400 && x > 15 && x < 235 && y < 96) region = 15;
  if (z > 1038 && z <= 1180 && x > 38 + .09 * (z - 1100) && x < 188 + .09 * (z - 1100) && y < -191 + .20 * (z - 1100)) region = 15;
  if (z > 950 && x < -145 - .20 * (z - 1180)) region = 17;
  if (z > 1095 && x < 5 - .24 * (z - 1260) && ellipse(-139, 117, 1292, 149, 218, 156)) region = 16;
  if (z > 860 && x < -363 + .47 * (z - 1060) && x > -551 + .68 * (z - 971) && y > 107) region = 18;
  if (z > 798 && z < 1010 && x < -527 + .58 * (z - 961) && y > 83 && x > -680) region = 19;
  const haftX = -602 - .66 * (z - 915), haftY = 211 - .86 * (z - 915);
  const nearHaft = ((x - haftX) / 57) ** 2 + ((y - haftY) / 61) ** 2 < 1;
  if (z > 702 && z < 1153 && x < -458 && (nearHaft || (z > 967 && x < -624) || z < 825)) region = 21;
  if (x < -655 && z > 1035 && z > 1136 + .53 * (x + 750)) region = 20;
  if (z > 1000 && x > 338 - .19 * (z - 1180)) region = 22;
  if (z > 1030 && x > 526 && .55 * (x - 624) - .83 * (y + 218) > 0) region = 23;
  if (z > 1040 && x > 637 && .48 * (x - 760) - .88 * (y + 444) > 0) region = 24;
  return region;
}

function weldedVertexIds(positions) {
  const [x0, y0, z0] = bounds(positions).min;
  const vertices = new Map();
  const ids = new Int32Array(positions.length / 3);
  for (let i = 0, j = 0; i < positions.length; i += 3, j++) {
    const x = Math.round((positions[i] - x0) * 100000);
    const y = Math.round((positions[i + 1] - y0) * 100000);
    const z = Math.round((positions[i + 2] - z0) * 100000);
    const key = `${x},${y},${z}`;
    let id = vertices.get(key);
    if (id === undefined) {
      id = vertices.size;
      vertices.set(key, id);
    }
    ids[j] = id;
  }
  return ids;
}

function sharedEdges(ids) {
  const links = new Int32Array(ids.length).fill(-1);
  const edges = new Map();
  for (let i = 0; i < ids.length; i += 3) {
    for (let side = 0; side < 3; side++) {
      const a = ids[i + side], b = ids[i + (side + 1) % 3];
      if (a === b) continue;
      const key = Math.min(a, b) * ids.length + Math.max(a, b);
      const slot = i + side;
      const entry = edges.get(key);
      if (entry === undefined) {
        edges.set(key, slot + 1);
      } else if (entry > 0) {
        const first = entry - 1;
        links[first] = slot;
        links[slot] = first;
        edges.set(key, -entry);
      } else if (entry < 0) {
        const first = -entry - 1;
        links[links[first]] = -1;
        links[first] = -1;
        edges.set(key, 0);
      }
    }
  }
  for (let slot = 0; slot < links.length; slot++) {
    const face = Math.floor(links[slot] / 3);
    links[slot] = face === Math.floor(slot / 3) ? -1 : face;
  }
  return links;
}

function triangleCenter(positions, index, axis) {
  const i = index * 9 + axis;
  return Math.fround(Math.fround(Math.fround(positions[i] + positions[i + 3]) + positions[i + 6]) / 3);
}

function seamLabels(positions, adjacency) {
  const count = positions.length / 9;
  const rough = new Uint8Array(count);
  for (let face = 0; face < count; face++) {
    rough[face] = classify(triangleCenter(positions, face, 0), triangleCenter(positions, face, 1), triangleCenter(positions, face, 2));
  }
  const width = 7;
  const depth = new Uint8Array(count).fill(255);
  const queue = new Int32Array(count);
  let end = 0;
  for (let face = 0; face < count; face++) {
    for (let edge = face * 3; edge < face * 3 + 3; edge++) {
      const other = adjacency[edge];
      if (other < 0 || rough[other] === rough[face]) continue;
      depth[face] = 0;
      queue[end++] = face;
      break;
    }
  }
  for (let cursor = 0; cursor < end; cursor++) {
    const face = queue[cursor];
    if (depth[face] >= width) continue;
    for (let edge = face * 3; edge < face * 3 + 3; edge++) {
      const other = adjacency[edge];
      if (other < 0 || depth[other] < 255) continue;
      depth[other] = depth[face] + 1;
      queue[end++] = other;
    }
  }
  const centers = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  for (let cursor = 0; cursor < end; cursor++) {
    const face = queue[cursor];
    const start = face * 3;
    for (let axis = 0; axis < 3; axis++) centers[start + axis] = triangleCenter(positions, face, axis);
    normals.set(normal(positions, face * 9), start);
  }
  const heap = [];
  function push(pair) {
    let index = heap.length;
    heap.push(pair);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent][0] <= pair[0]) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = pair;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (!heap.length) return first;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
      if (heap[child][0] >= last[0]) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  }
  // Grow from both sides of each seam and favor cuts along sharp changes in the surface.
  const labels = rough.slice();
  const costs = new Float64Array(count).fill(Infinity);
  for (let cursor = 0; cursor < end; cursor++) {
    const face = queue[cursor];
    if (depth[face] !== width) continue;
    costs[face] = 0;
    push([0, face]);
  }
  while (heap.length) {
    const [cost, face] = pop();
    if (cost !== costs[face]) continue;
    const start = face * 3;
    for (let edge = start; edge < start + 3; edge++) {
      const other = adjacency[edge];
      if (other < 0 || depth[other] >= width) continue;
      const next = other * 3;
      const distance = Math.hypot(centers[start] - centers[next], centers[start + 1] - centers[next + 1], centers[start + 2] - centers[next + 2]);
      const alignment = normals[start] * normals[next] + normals[start + 1] * normals[next + 1] + normals[start + 2] * normals[next + 2];
      const penalty = 1 + 4 * Math.min(2, Math.max(0, 1 - alignment)) ** .70;
      const estimate = cost + Math.max(.15, distance) * penalty * (labels[face] === rough[other] ? 1 : 1.17);
      if (estimate >= costs[other]) continue;
      costs[other] = estimate;
      labels[other] = labels[face];
      push([estimate, other]);
    }
  }
  return labels;
}

function joinLabelIslands(labels, adjacency) {
  const queue = new Int32Array(labels.length);
  const seen = new Uint8Array(labels.length);
  const contacts = new Uint32Array(regions.length);
  // Tiny patches can join the adjacent region with the longest shared seam.
  for (let pass = 0; pass < 2; pass++) {
    seen.fill(0);
    for (let first = 0; first < labels.length; first++) {
      if (seen[first]) continue;
      const own = labels[first];
      let size = 1;
      queue[0] = first;
      seen[first] = 1;
      contacts.fill(0);
      for (let cursor = 0; cursor < size; cursor++) {
        const start = queue[cursor] * 3;
        for (let edge = start; edge < start + 3; edge++) {
          const other = adjacency[edge];
          if (other < 0) continue;
          if (labels[other] !== own) {
            contacts[labels[other]]++;
          } else if (!seen[other]) {
            seen[other] = 1;
            queue[size++] = other;
          }
        }
      }
      if (size >= 500) continue;
      let target = own;
      for (let label = 0; label < contacts.length; label++) {
        if (contacts[label] > contacts[target]) target = label;
      }
      if (target === own) continue;
      for (let i = 0; i < size; i++) labels[queue[i]] = target;
    }
  }
  const component = new Int32Array(labels.length).fill(-1);
  const largest = regions.map(() => ({ root: -1, size: 0 }));
  for (let first = 0; first < labels.length; first++) {
    if (component[first] >= 0) continue;
    const label = labels[first];
    let size = 1;
    queue[0] = first;
    component[first] = first;
    for (let cursor = 0; cursor < size; cursor++) {
      const start = queue[cursor] * 3;
      for (let edge = start; edge < start + 3; edge++) {
        const other = adjacency[edge];
        if (other < 0 || component[other] >= 0 || labels[other] !== label) continue;
        component[other] = first;
        queue[size++] = other;
      }
    }
    if (size > largest[label].size) largest[label] = { root: first, size };
  }
  let end = 0;
  for (let face = 0; face < labels.length; face++) {
    if (component[face] !== largest[labels[face]].root) continue;
    component[face] = -1;
    queue[end++] = face;
  }
  for (let cursor = 0; cursor < end; cursor++) {
    const face = queue[cursor];
    for (let edge = face * 3; edge < face * 3 + 3; edge++) {
      const other = adjacency[edge];
      if (other < 0 || component[other] < 0) continue;
      component[other] = -1;
      labels[other] = labels[face];
      queue[end++] = other;
    }
  }
}

export function splitOgreRegions(positions) {
  if (positions.length !== sourceTriangles * 9) throw new Error('Unexpected Ogre triangle count.');
  const adjacency = sharedEdges(weldedVertexIds(positions));
  const labels = seamLabels(positions, adjacency);
  joinLabelIslands(labels, adjacency);
  const counts = new Uint32Array(regions.length);
  for (const label of labels) counts[label]++;
  if (counts.some(count => count === 0)) throw new Error('An authored Ogre region is empty.');
  const result = regions.map(([name, direction], index) => ({
    name, positions: new Float32Array(counts[index] * 9), explosionOffset: direction.map(value => value * 350)
  }));
  counts.fill(0);
  for (let face = 0; face < labels.length; face++) {
    const label = labels[face];
    const start = face * 9;
    result[label].positions.set(positions.subarray(start, start + 9), counts[label]);
    counts[label] += 9;
  }
  return result;
}
