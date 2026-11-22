import { splitConnected, bounds } from './geometry.js';
import { findFigurineParts, figurineTriangleLimit } from './figurine-parts.js';

self.onmessage = ({ data }) => {
  try {
    const parts = [];
    let triangles = 0;
    for (const source of data.sources) {
      triangles += source.positions.length / 9;
      if (triangles > 1_500_000) throw new Error('Maximum 1.5 million triangles per model.');
      const box = bounds(source.positions);
      const tolerance = Math.max(1e-7, Math.hypot(...box.size) * 1e-8);
      const pieces = splitConnected(source.positions, tolerance);
      for (let i = 0; i < pieces.length; i++) {
        const name = pieces.length > 1 ? `${source.name} · ${i + 1}` : source.name;
        parts.push({ name, positions: pieces[i] });
      }
    }
    if (parts.length > 2500) throw new Error(`Found ${parts.length.toLocaleString()} fragments. This prototype supports 2,500 parts; repair or simplify the mesh first.`);

    let segmentation = 'shells';
    let discovered = parts;
    if (data.infer && parts.length === 1) {
      segmentation = triangles > figurineTriangleLimit ? 'too-large' : 'no-match';
      const inferred = findFigurineParts(parts[0].positions);
      if (inferred) {
        segmentation = 'figurine';
        discovered = inferred;
      }
    }
    self.postMessage({ parts: discovered, segmentation, figurineTriangleLimit }, discovered.map(part => part.positions.buffer));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
