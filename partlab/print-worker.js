import { zipSync, strToU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
import { buildPrintProject } from './print-project.js?v=0.3.8';

self.onmessage = ({ data }) => {
  try {
    const { files, warnings, objectCount, pitch, assembled, fitsPlate } = buildPrintProject(data);
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])), { level: 4 });
    self.postMessage({ bytes, warnings, objectCount, pitch, assembled, fitsPlate }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
