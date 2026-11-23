import { buildRegionSolids } from './region-solids.js?v=0.3.8';

export const coreNS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
export const materialNS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
export const defaultFilaments = Object.freeze([
  '#C9BDA4', '#648A58', '#9C553B', '#485666', '#E2B64C', '#8F75B4', '#4799AA', '#D97991'
]);
export function orcaPaintCode(slot) {
  const state = slot + 1;
  if (state === 1 || state === 2) return `${state * 4}`;
  if (state <= 17) return `${(state - 3).toString(16).toUpperCase()}C`;
  if (state <= 32) return `${(state - 18).toString(16).toUpperCase()}FC`;
  return '';
}
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const number = value => String(Math.round(value * 100000) / 100000);

// Restitch inspection regions before adding per-face paint. Standalone bodies stay separate.
function indexedBody(parts, scale, origin) {
  const vertices = [];
  const faces = [];
  const vertexMap = new Map();
  const faceKeys = new Set();
  const edges = new Map();
  let removed = 0;
  for (const part of parts) {
    const { positions, indices } = part;
    const count = indices?.length ?? positions.length / 3;
    const slot = part.slot ?? 0;
    for (let triangle = 0; triangle < count; triangle += 3) {
      const corners = [];
      for (let j = 0; j < 3; j++) {
        const at = (indices ? indices[triangle + j] : triangle + j) * 3;
        const point = [0, 1, 2].map(axis => number((positions[at + axis] - origin[axis]) * scale));
        const key = point.join(',');
        if (!vertexMap.has(key)) {
          vertexMap.set(key, vertices.length);
          vertices.push(point);
        }
        corners.push(vertexMap.get(key));
      }
      const key = [...corners].sort((a, b) => a - b).join(',');
      if (new Set(corners).size !== 3 || faceKeys.has(key)) { removed++; continue; }
      faceKeys.add(key);
      faces.push({ corners, slot });
      for (let i = 0; i < 3; i++) {
        const a = corners[i], b = corners[(i + 1) % 3];
        const edge = `${Math.min(a, b)},${Math.max(a, b)}`;
        const info = edges.get(edge) ?? [0, 0];
        info[0]++;
        info[1] += a < b ? 1 : -1;
        edges.set(edge, info);
      }
    }
  }
  let open = 0, irregular = 0;
  for (const [count, direction] of edges.values()) {
    if (count === 1) open++;
    else if (count !== 2 || direction !== 0) irregular++;
  }
  if (!faces.length) throw new Error('An export body has no valid triangles.');
  return { vertices, faces, open, irregular, removed };
}

export function buildPrintProject({ name, parts, fins = [], filaments, scale, origin, fused, separateRegions = true, groupObjects = false, plate }) {
  if (filaments.length > defaultFilaments.length) throw new Error(`Use at most ${defaultFilaments.length} filament slots.`);
  if (!filaments.length || filaments.some(color => !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('Choose valid filament colors.');
  if (!parts.length) throw new Error('Open a model before exporting.');
  if ([...parts, ...fins].some(({ slot = 0 }) => !Number.isInteger(slot) || slot < 0 || slot >= filaments.length)) {
    throw new Error('A region refers to a missing filament slot.');
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Choose a positive print size.');
  if (plate && ![plate.width, plate.depth].every(size => Number.isFinite(size) && size > 0)) {
    throw new Error('Choose positive build plate dimensions.');
  }
  const groups = fused && !separateRegions ? [{ name, parts }] : parts.map(part => ({ name: part.name, parts: [part] }));
  let pitch;
  if (fused && separateRegions) {
    const markedRegions = parts.filter(part => part.inferred || part.explosionOffset);
    const regions = markedRegions.length ? markedRegions : parts;
    const converted = buildRegionSolids(regions, scale, origin);
    pitch = converted.pitch;
    const byRegion = new Map(regions.map((part, index) => [part, converted.bodies[index]]));
    for (const group of groups) group.body = byRegion.get(group.parts[0]);
  }
  const modelCount = groups.length;
  for (const fin of fins) groups.push({ name: fin.name, parts: [fin] });
  const warnings = { open: 0, irregular: 0, removed: 0 };
  const palette = filaments.map(color => `<m:color color="${color.toUpperCase()}"/>`).join('');
  const resources = [`<m:colorgroup id="1">${palette}</m:colorgroup>`];
  const partsConfig = [];
  const objectsConfig = [];
  const ids = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const modelMin = [...min], modelMax = [...max];
  for (const [index, group] of groups.entries()) {
    const body = group.body ?? indexedBody(group.parts, scale, origin);
    for (const key of Object.keys(warnings)) warnings[key] += body[key];
    const id = index + 2;
    const defaultSlot = group.parts[0].slot ?? 0;
    const vertices = body.vertices.map(([x, y, z]) => {
      if (plate) {
        for (const [axis, raw] of [x, y, z].entries()) {
          const value = Number(raw);
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
          if (index < modelCount) {
            modelMin[axis] = Math.min(modelMin[axis], value);
            modelMax[axis] = Math.max(modelMax[axis], value);
          }
        }
      }
      return `<vertex x="${number(x)}" y="${number(y)}" z="${number(z)}"/>`;
    }).join('');
    const faces = body.faces.map(({ corners: [a, b, c], slot }) => {
      const paint = group.parts.length > 1 ? orcaPaintCode(slot) : '';
      return `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${slot}" p2="${slot}" p3="${slot}"${paint ? ` paint_color="${paint}"` : ''}/>`;
    }).join('');
    resources.push(`<object id="${id}" type="model" name="${xml(group.name)}" pid="1" pindex="${defaultSlot}"><mesh><vertices>${vertices}</vertices><triangles>${faces}</triangles></mesh></object>`);
    ids.push(id);
    const metadata = `<metadata key="name" value="${xml(group.name)}"/><metadata key="extruder" value="${defaultSlot + 1}"/>`;
    const part = `<part id="${id}" subtype="normal_part">${metadata}</part>`;
    partsConfig.push(part);
    objectsConfig.push(`<object id="${id}" auto_drop="0">${metadata}${part}</object>`);
  }
  const assembled = groupObjects && ids.length > 1;
  const rootId = groups.length + 2;
  let config = objectsConfig.join('');
  if (assembled) {
    const components = ids.map(id => `<component objectid="${id}"/>`).join('');
    resources.push(`<object id="${rootId}" type="model" name="${xml(name)}"><components>${components}</components></object>`);
    const metadata = `<metadata key="name" value="${xml(name)}"/><metadata key="extruder" value="1"/>`;
    config = `<object id="${rootId}" auto_drop="0">${metadata}${partsConfig.join('')}</object>`;
  }
  const settings = { filament_colour: filaments.map(color => color.toUpperCase()) };
  let transform = '', fitsPlate;
  if (plate) {
    const half = [plate.width / 2, plate.depth / 2];
    const center = plate.originAtCenter ? [0, 0] : half;
    const plateMin = center.map((value, axis) => value - half[axis]);
    const plateMax = center.map((value, axis) => value + half[axis]);
    const offset = center.map((value, axis) => value - (modelMin[axis] + modelMax[axis]) / 2);
    fitsPlate = offset.every((value, axis) => min[axis] + value >= plateMin[axis] - .00001 &&
      max[axis] + value <= plateMax[axis] + .00001);
    transform = ` transform="1 0 0 0 1 0 0 0 1 ${[...offset, -min[2]].map(number).join(' ')}"`;
    const [left, front] = plateMin.map(number), [right, back] = plateMax.map(number);
    settings.printable_area = [`${left}x${front}`, `${right}x${front}`, `${right}x${back}`, `${left}x${back}`];
  }
  const items = (assembled ? [rootId] : ids).map(id => `<item objectid="${id}"${transform} printable="1"/>`);
  return {
    warnings, objectCount: groups.length, pitch, assembled, fitsPlate,
    files: {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      '3D/3dmodel.model': `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${coreNS}" xmlns:m="${materialNS}"><metadata name="Application">PartLab</metadata><resources>${resources.join('')}</resources><build>${items.join('')}</build></model>`,
      'Metadata/model_settings.config': `<?xml version="1.0" encoding="UTF-8"?><config>${config}</config>`,
      'Metadata/project_settings.config': JSON.stringify(settings)
    }
  };
}

// A flared foot, a triangular web, and one short horizontal contact tab form a closed solid.
// Geometry is constructed in print millimeters before converting to viewer coordinates.
export function makeSupportFin({ anchor, bed, scale, angle, footprint, thickness, gap }) {
  const height = (anchor[2] - bed) * scale - gap;
  if (![height, scale, footprint, thickness, angle, gap].every(Number.isFinite) || scale <= 0 ||
      height < 4 || footprint < 5 || thickness <= 0 || gap < 0) throw new Error('The fin needs at least 4 mm of clearance above the bed.');
  const reach = 1.5;
  const base = Math.min(.8, height * .15);
  const tip = Math.min(.65, height * .13);
  const bodyThickness = Math.max(thickness, .4);
  const footLength = Math.max(footprint, height * .48, reach + bodyThickness + 1.3);
  // The rounded toe is approximated by a bevel. The tab stays horizontal at the top.
  const profile = [[.65, 0], [footLength - .65, 0], [footLength, base],
    [reach + bodyThickness, height], [0, height], [0, height - tip],
    [reach, height - tip], [.15, base]];
  const local = profile.map(([x, z]) => ({ x, z, width: z <= base ? bodyThickness * 1.9 : z === height && x === 0 ? bodyThickness * .5 : bodyThickness }));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const vertices = [];
  for (const side of [-1, 1]) {
    for (const { x, z, width } of local) {
      const y = side * width / 2;
      vertices.push(anchor[0] + (cos * x - sin * y) / scale, anchor[1] + (sin * x + cos * y) / scale, bed + z / scale);
    }
  }
  // Ear-clipping in the profile plane, including the concave underside of the tab.
  const face = profile.map((_, index) => index);
  const triangles = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  while (face.length > 3) {
    const ear = face.findIndex((b, i) => {
      const a = face[(i + face.length - 1) % face.length], c = face[(i + 1) % face.length];
      const [A, B, C] = [profile[a], profile[b], profile[c]];
      return cross(A, B, C) > 0 && !face.some(v => v !== a && v !== b && v !== c &&
        cross(A, B, profile[v]) >= 0 && cross(B, C, profile[v]) >= 0 && cross(C, A, profile[v]) >= 0);
    });
    if (ear < 0) throw new Error('Could not triangulate the fin. Try a wider foot.');
    triangles.push(face[(ear + face.length - 1) % face.length], face[ear], face[(ear + 1) % face.length]);
    face.splice(ear, 1);
  }
  triangles.push(...face);
  const n = profile.length;
  const indices = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.slice(i, i + 3);
    indices.push(a, b, c, a + n, c + n, b + n);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, i + n, j + n, i, j + n, j);
  }
  return { positions: new Float32Array(vertices), indices: new Uint16Array(indices), footLength };
}
