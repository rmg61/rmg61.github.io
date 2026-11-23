// Sample the closed exterior, then fill it with the nearest named surface regions.
// All bodies share one grid so their internal walls meet without gaps or overlap.
export function buildRegionSolids(parts, scale, origin) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      const point = (positions[i] - origin[axis]) * scale;
      lo[axis] = Math.min(lo[axis], point);
      hi[axis] = Math.max(hi[axis], point);
    }
  }
  const span = hi.map((max, axis) => max - lo[axis]);
  const maxCells = 10_000_000;
  let pitch = Math.max(.35, Math.max(...span) / 450);
  let start, dims;
  do {
    start = lo.map(min => Math.floor(min / pitch) - 1);
    dims = hi.map((max, axis) => Math.ceil(max / pitch) - start[axis] + 1);
    if (dims[0] * dims[1] * dims[2] <= maxCells) break;
    pitch *= 1.1;
  } while (true);
  const [nx, ny, nz] = dims;
  const stride = [1, nx, nx * ny];
  const columns = new Array(nx * ny);
  const offset = [.500013, .500027, .500041];
  const inside = new Uint8Array(nx * ny * nz);
  const labels = new Uint16Array(inside.length);
  const distance = new Float32Array(inside.length).fill(Infinity);

  function rasterize(axis, hit) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    const gridOrigin = origin.map((value, i) => value + start[i] * pitch / scale);
    const points = [a, b, c];
    for (const [partIndex, { positions, indices }] of parts.entries()) {
      const count = indices?.length ?? positions.length / 3;
      for (let i = 0; i < count; i += 3) {
        for (let j = 0; j < 3; j++) {
          const index = (indices ? indices[i + j] : i + j) * 3;
          const point = points[j];
          for (let k = 0; k < 3; k++) point[k] = (positions[index + k] - gridOrigin[k]) * scale / pitch;
        }
        const bu = b[u] - a[u], bv = b[v] - a[v];
        const cu = c[u] - a[u], cv = c[v] - a[v];
        const det = bu * cv - bv * cu;
        if (Math.abs(det) < 1e-12) continue;
        const minU = Math.max(0, Math.ceil(Math.min(a[u], b[u], c[u]) - offset[u]));
        const maxU = Math.min(dims[u] - 1, Math.floor(Math.max(a[u], b[u], c[u]) - offset[u]));
        const minV = Math.max(0, Math.ceil(Math.min(a[v], b[v], c[v]) - offset[v]));
        const maxV = Math.min(dims[v] - 1, Math.floor(Math.max(a[v], b[v], c[v]) - offset[v]));
        for (let y = minV; y <= maxV; y++) {
          const dy = y + offset[v] - a[v];
          for (let x = minU; x <= maxU; x++) {
            const dx = x + offset[u] - a[u];
            const s = (dx * cv - dy * cu) / det;
            const t = (bu * dy - bv * dx) / det;
            if (s < 0 || t < 0 || s + t > 1) continue;
            const depth = a[axis] + s * (b[axis] - a[axis]) + t * (c[axis] - a[axis]);
            hit(x * stride[u] + y * stride[v], depth, partIndex + 1);
          }
        }
      }
    }
  }

  rasterize(2, (column, depth, label) => {
    (columns[column] ??= []).push({ depth, label });
  });

  function seed(column, depth, label, axis) {
    const position = depth - offset[axis];
    const lower = Math.floor(position);
    for (let cell = lower; cell <= lower + 1; cell++) {
      if (cell < 0 || cell >= dims[axis]) continue;
      const index = column + cell * stride[axis];
      const delta = Math.abs(position - cell);
      if (inside[index] && delta < distance[index]) {
        distance[index] = delta;
        labels[index] = label;
      }
    }
  }

  let oddColumns = 0, hitColumns = 0, occupied = 0;
  for (const [index, values] of columns.entries()) {
    if (!values) continue;
    hitColumns++;
    values.sort((a, b) => a.depth - b.depth);
    const crossings = values.filter((hit, i) => i === 0 || hit.depth - values[i - 1].depth > 1e-7);
    if (crossings.length % 2) {
      oddColumns++;
      continue;
    }
    for (let i = 0; i < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i].depth - offset[2]));
      const to = Math.min(nz - 1, Math.floor(crossings[i + 1].depth - offset[2]));
      for (let z = from; z <= to; z++) {
        inside[index + z * stride[2]] = 1;
        occupied++;
      }
    }
    for (const { depth, label } of crossings) seed(index, depth, label, 2);
  }
  if (!hitColumns || oddColumns > Math.max(2, hitColumns * .005)) {
    throw new Error('Too many gaps in the fused mesh to create separate solids. Try the Painted surface layout or repair the source mesh.');
  }
  rasterize(0, (column, depth, label) => seed(column, depth, label, 0));
  rasterize(1, (column, depth, label) => seed(column, depth, label, 1));

  const queue = new Uint32Array(inside.length);
  let length = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) queue[length++] = i;
  }
  for (let i = 0; i < length; i++) {
    const index = queue[i];
    for (const step of stride) {
      for (const neighbor of [index - step, index + step]) {
        // The one-cell empty border prevents crossing from one row to another.
        if (inside[neighbor] && !labels[neighbor]) {
          labels[neighbor] = labels[index];
          queue[length++] = neighbor;
        }
      }
    }
  }
  if (length !== occupied) throw new Error('Some interior cells have no matching surface region. Try the Painted surface layout.');

  const gx = nx + 1, layer = gx * (ny + 1);
  const quads = parts.map(() => []);
  // Counterclockwise outward-facing corners for the negative and positive face of each axis.
  const cornerOffsets = [
    [0, layer, layer + gx, gx],
    [1, 1 + gx, 1 + gx + layer, 1 + layer],
    [0, 1, 1 + layer, layer],
    [gx, gx + layer, gx + layer + 1, gx + 1],
    [0, gx, gx + 1, 1],
    [layer, layer + 1, layer + 1 + gx, layer + gx]
  ];
  for (let i = 0; i < length; i++) {
    const index = queue[i];
    const label = labels[index];
    const x = index % nx, y = Math.floor(index / nx) % ny, z = Math.floor(index / stride[2]);
    const vertex = x + y * gx + z * layer;
    for (let face = 0; face < 6; face++) {
      const step = stride[face >> 1];
      if (labels[index + (face % 2 ? step : -step)] !== label) {
        quads[label - 1].push({ cell: index, corners: cornerOffsets[face].map(j => vertex + j) });
      }
    }
  }
  const missing = parts.filter((_, index) => !quads[index].length);
  if (missing.length) {
    throw new Error(`Separate solids could not preserve ${missing.length === 1 ? missing[0].name : missing.length + ' small regions'} at this print size. Increase the size or choose Painted surface.`);
  }
  const gridPoint = index => [index % gx, Math.floor(index / gx) % (ny + 1), Math.floor(index / layer)]
    .map((value, axis) => (value + start[axis]) * pitch);
  return {
    pitch,
    bodies: quads.map((faces, index) => meshRegion(faces, gridPoint, gx, layer, parts[index].slot ?? 0))
  };
}

function meshRegion(quads, gridPoint, gx, layer, slot) {
  // A grid edge can meet four faces when two same-region voxels touch diagonally.
  // Pair faces on each voxel separately in that case to keep the mesh manifold.
  const edges = new Map();
  const diagonalPairs = [];
  const parent = Int32Array.from({ length: quads.length * 4 }, (_, index) => index);
  function find(index) {
    while (index !== parent[index]) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  function pair(a, b) {
    parent[find(b.lo)] = find(a.lo);
    parent[find(b.hi)] = find(a.hi);
  }
  for (const [face, { cell, corners }] of quads.entries()) {
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const a = corners[i], b = corners[next];
      const delta = Math.abs(b - a);
      const axis = delta === 1 ? 0 : delta === gx ? 1 : 2;
      if (axis === 2 && delta !== layer) throw new Error('Invalid grid edge.');
      const key = Math.min(a, b) * 3 + axis;
      const lo = face * 4 + (a < b ? i : next), hi = face * 4 + (a < b ? next : i);
      const entry = { cell, lo, hi, side: face * 4 + i, point: Math.min(a, b), delta };
      const incident = edges.get(key);
      if (incident) incident.push(entry);
      else edges.set(key, [entry]);
    }
  }
  for (const incident of edges.values()) {
    if (incident.length === 2) pair(...incident);
    else if (incident.length === 4) {
      const [first, ...other] = incident;
      const match = other.findIndex(item => item.cell === first.cell);
      if (match < 0) throw new Error('Invalid shared grid edge.');
      const second = other.splice(match, 1)[0];
      pair(first, second);
      pair(...other);
      diagonalPairs.push([[first, second], other]);
    } else throw new Error('Open grid edge while separating regions.');
  }
  const vertices = [], faces = [];
  const ids = new Int32Array(parent.length).fill(-1);
  const splitEdges = new Map();
  for (const [first, second] of diagonalPairs) {
    const [a] = first, [b] = second;
    if (find(a.lo) !== find(b.lo) || find(a.hi) !== find(b.hi)) continue;
    // Even if both endpoints are shared through other faces, these edges are distinct.
    const lo = gridPoint(a.point), hi = gridPoint(a.point + a.delta);
    const midpoint = lo.map((value, axis) => (value + hi[axis]) / 2);
    for (const edge of [first, second]) {
      const id = vertices.push(midpoint) - 1;
      for (const { side } of edge) splitEdges.set(side, id);
    }
  }
  for (const [face, { corners }] of quads.entries()) {
    const quad = corners.map((point, i) => {
      const root = find(face * 4 + i);
      if (ids[root] === -1) {
        ids[root] = vertices.length;
        vertices.push(gridPoint(point));
      }
      return ids[root];
    });
    const boundary = quad.flatMap((id, i) => {
      const mid = splitEdges.get(face * 4 + i);
      return mid === undefined ? [id] : [id, mid];
    });
    if (boundary.length === 4) {
      const [a, b, c, d] = boundary;
      faces.push({ corners: [a, b, c], slot }, { corners: [a, c, d], slot });
    } else {
      const center = vertices[quad[0]].map((value, axis) => (value + vertices[quad[2]][axis]) / 2);
      const id = vertices.push(center) - 1;
      for (const [index, corner] of boundary.entries()) {
        faces.push({ corners: [corner, boundary[(index + 1) % boundary.length], id], slot });
      }
    }
  }
  return { vertices, faces, open: 0, irregular: 0, removed: 0 };
}
