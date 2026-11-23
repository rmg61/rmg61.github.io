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
    // Stray faces should not prevent discovery on a single dominant figurine shell.
    // Keep distinct source bodies and substantial disconnected pieces intact.
    const main = parts[0];
    const mainTriangles = main?.positions.length / 9;
    const dominant = parts.length === 1 ||
      (data.sources.length === 1 && mainTriangles >= triangles * .98);
    if (data.infer && main && dominant) {
      if (mainTriangles > figurineTriangleLimit) {
        segmentation = 'too-large';
      } else {
        segmentation = 'no-match';
        const inferred = findFigurineParts(main.positions);
        if (inferred && inferred.length + parts.length - 1 <= 2500) {
          segmentation = 'figurine';
          discovered = [...inferred, ...parts.slice(1)];
        }
      }
    }
    self.postMessage({ parts: discovered, segmentation, figurineTriangleLimit }, discovered.map(part => part.positions.buffer));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
