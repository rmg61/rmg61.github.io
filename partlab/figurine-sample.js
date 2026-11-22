// Build a single watertight surface from blended primitives. The mesh has no part labels.
const step = 1.6;
const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const tetrahedra = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];

function figureField(x, y, z) {
  let distance = Infinity;
  function ellipsoid(cx, cy, cz, rx, ry, rz, blend = 2.5) {
    const d = (Math.hypot((x-cx)/rx, (y-cy)/ry, (z-cz)/rz) - 1) * Math.min(rx, ry, rz);
    const overlap = Math.max(blend - Math.abs(distance - d), 0);
    distance = Math.min(distance, d) - overlap * overlap / (4 * blend);
  }
  ellipsoid(0, 0, 59, 15, 10, 20); // suit
  ellipsoid(0, 1, 44, 14, 10, 10);
  ellipsoid(0, 8, 61, 11, 7, 15); // backpack
  ellipsoid(0, -9, 63, 9, 3.5, 7); // chest panel
  ellipsoid(0, 0, 77, 8, 7, 9); // collar
  ellipsoid(0, 0, 90, 14, 12, 14); // helmet
  ellipsoid(0, -8, 91, 11, 6.5, 8); // visor
  for (const side of [-1, 1]) {
    ellipsoid(side * 14, 0, 66, 9, 8, 10);
    ellipsoid(side * 21, 0, 59, 7.5, 7, 12);
    ellipsoid(side * 25, -2, 50, 7, 7, 11);
    ellipsoid(side * 28, -4, 43, 6.5, 6.5, 7);
    ellipsoid(side * 9, 0, 32, 7.8, 8, 17);
    ellipsoid(side * 11, 0, 17, 7.3, 7, 13);
    ellipsoid(side * 12, -4, 7.5, 7.8, 11, 7);
  }
  return distance;
}

export function makeFigurine() {
  const origin = [-40.37, -22.19, -5.23];
  const [width, depth, height] = [52, 29, 72];
  const nodes = new Array(width * depth * height);
  const index = (x, y, z) => (z * depth + y) * width + x;
  for (let z = 0; z < height; z++) {
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        const point = [x, y, z].map((value, axis) => origin[axis] + step * value);
        const id = index(x, y, z);
        nodes[id] = { point, value: figureField(...point), id };
      }
    }
  }

  const triangles = [];
  function interpolate(a, b) {
    if (a.id > b.id) [a, b] = [b, a];
    const t = a.value / (a.value - b.value);
    return a.point.map((value, axis) => value + t * (b.point[axis] - value));
  }
  function emit(a, b, c, inside, outside) {
    const u = b.map((value, axis) => value - a[axis]);
    const v = c.map((value, axis) => value - a[axis]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const direction = n.reduce((sum, value, axis) => sum + value * (outside.point[axis] - inside.point[axis]), 0);
    triangles.push(...a, ...(direction > 0 ? b : c), ...(direction > 0 ? c : b));
  }
  for (let z = 0; z < height - 1; z++) {
    for (let y = 0; y < depth - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const cube = corners.map(([dx, dy, dz]) => nodes[index(x + dx, y + dy, z + dz)]);
        const insideCount = cube.filter(node => node.value < 0).length;
        if (insideCount === 0 || insideCount === 8) continue;
        for (const tetrahedron of tetrahedra) {
          const points = tetrahedron.map(i => cube[i]);
          const inside = points.filter(node => node.value < 0);
          const outside = points.filter(node => node.value >= 0);
          if (inside.length === 1 || inside.length === 3) {
            const lone = inside.length === 1 ? inside[0] : outside[0];
            const opposite = inside.length === 1 ? outside : inside;
            emit(...opposite.map(node => interpolate(lone, node)), inside[0], outside[0]);
          } else if (inside.length === 2) {
            const [a, b] = inside.map(inner => outside.map(outer => interpolate(inner, outer)));
            emit(a[0], a[1], b[0], inside[0], outside[0]);
            emit(a[1], b[1], b[0], inside[0], outside[0]);
          }
        }
      }
    }
  }
  return new Float32Array(triangles);
}
