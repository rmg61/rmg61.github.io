// Read the self-contained GLB files produced for PartLab's detailed region studies.
// Keep geometry in its original local Z-up coordinates and use animation endpoints for spacing.
export function readRegionGLB(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== view.byteLength) {
    throw new Error('This is not a valid GLB 2.0 file.');
  }
  const jsonLength = view.getUint32(12, true);
  const binHeader = 20 + jsonLength;
  const binOffset = binHeader + 8;
  if (binOffset > view.byteLength || view.getUint32(16, true) !== 0x4e4f534a ||
      view.getUint32(binHeader + 4, true) !== 0x004e4942 ||
      binOffset + view.getUint32(binHeader, true) !== view.byteLength) {
    throw new Error('The GLB is missing its embedded geometry.');
  }
  const document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  if (document.extras?.surfaceRegions !== true || !Array.isArray(document.nodes) ||
      document.buffers?.length !== 1 || document.buffers[0].uri) {
    throw new Error('Choose a PartLab region GLB, such as the supplied Ogre file.');
  }

  function readAccessor(index, type, allowed) {
    const accessor = document.accessors?.[index];
    const data = document.bufferViews?.[accessor?.bufferView];
    if (accessor?.type !== type || !Number.isSafeInteger(accessor.count) || accessor.count <= 0 ||
        !allowed.includes(accessor.componentType) || accessor.sparse || accessor.normalized ||
        data?.buffer !== 0 || data.byteStride) {
      throw new Error('The GLB uses an unsupported geometry layout.');
    }
    const ArrayType = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[accessor.componentType];
    const length = (type === 'VEC3' ? 3 : 1) * accessor.count;
    const viewStart = data.byteOffset ?? 0;
    const accessStart = accessor.byteOffset ?? 0;
    const start = binOffset + viewStart + accessStart;
    const size = length * ArrayType.BYTES_PER_ELEMENT;
    if (![viewStart, accessStart, data.byteLength, size].every(value => Number.isSafeInteger(value) && value >= 0) ||
        start % ArrayType.BYTES_PER_ELEMENT || accessStart + size > data.byteLength ||
        binOffset + viewStart + data.byteLength > view.byteLength) {
      throw new Error('A GLB geometry block points outside the file.');
    }
    return new ArrayType(buffer, start, length);
  }

  const animation = document.animations?.find(item => item.name === 'Assemble to exploded');
  const offsets = new Map();
  for (const channel of animation?.channels ?? []) {
    if (channel.target?.path !== 'translation') continue;
    const output = readAccessor(animation.samplers?.[channel.sampler]?.output, 'VEC3', [5126]);
    const from = output.subarray(0, 3);
    const to = output.subarray(output.length - 3);
    if (output.length !== 6 || !from.every(value => value === 0) || !to.every(Number.isFinite)) {
      throw new Error('The GLB has invalid explosion offsets.');
    }
    offsets.set(channel.target.node, Array.from(to));
  }

  let triangleCount = 0;
  const parts = [];
  for (const [nodeId, node] of document.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const mesh = document.meshes?.[node.mesh];
    const primitive = mesh?.primitives?.[0];
    if (mesh?.primitives?.length !== 1 || (primitive.mode ?? 4) !== 4 || !offsets.has(nodeId)) {
      throw new Error('The GLB is missing region geometry or explosion offsets.');
    }
    const positions = readAccessor(primitive.attributes?.POSITION, 'VEC3', [5126]);
    const normals = readAccessor(primitive.attributes?.NORMAL, 'VEC3', [5126]);
    const indices = readAccessor(primitive.indices, 'SCALAR', [5123, 5125]);
    if (indices.length % 3 || normals.length !== positions.length ||
        !positions.every(Number.isFinite) || !normals.every(Number.isFinite) ||
        !indices.every(index => index < positions.length / 3)) {
      throw new Error('The GLB contains invalid triangle geometry.');
    }
    triangleCount += indices.length / 3;
    if (triangleCount > 1_500_000 || parts.length >= 2500) throw new Error('The GLB exceeds the model limits.');
    const color = node.extras?.displayColor;
    parts.push({
      name: typeof node.name === 'string' && node.name.trim() ? node.name : `Region ${parts.length + 1}`,
      positions, normals, indices,
      explosionOffset: offsets.get(nodeId),
      color: Array.isArray(color) && color.length === 3 && color.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
        ? `rgb(${color.join(',')})` : undefined
    });
  }
  if (parts.length < 2) throw new Error('The GLB does not contain an exploded region set.');
  return parts;
}

export function trianglePositions(part) {
  if (!part.indices) return part.positions;
  const positions = new Float32Array(part.indices.length * 3);
  for (let i = 0; i < part.indices.length; i++) {
    const start = part.indices[i] * 3;
    positions.set(part.positions.subarray(start, start + 3), i * 3);
  }
  return positions;
}
