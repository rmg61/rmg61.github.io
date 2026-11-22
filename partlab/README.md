# PartLab — test web app

Browser-based 3D model exploration. Static files, compatible with GitHub Pages. No build step or server-side processing. Model files stay in the browser; rendering/parser libraries and optional fonts load from pinned CDN URLs.

## Run

From this directory run `python -m http.server 8765 --bind 127.0.0.1`, then open http://localhost:8765. Do not open index.html directly: JavaScript modules and workers require HTTP. Internet access is needed for dependencies. Run geometry checks with `node --test tests/*.test.js`.

## Prototype behavior

- One file at a time: STL, OBJ, 3MF, STEP/STP.
- Drag with the left or right button to orbit. Left click selects a part. Fusion shortcuts are also available: middle drag to pan, Shift + middle drag to orbit, wheel to zoom, and F to fit. Orientation buttons offer preset views.
- **Explode into parts** preserves source mesh and body boundaries, then splits disconnected triangle shells. For a single connected shell, it also checks for a neck and gaps beside the torso and between the legs. If those landmarks are clear, it follows the surface to suggest a head, torso, two arms, and two legs. This works best with roughly upright humanoids wearing distinct silhouettes and supports single shells up to 180,000 triangles. Joined limbs, accessories, and unusual poses can prevent a match.
- Slider spreads parts along directions from the assembly center. Reassemble restores their exact original coordinates. Select parts on the canvas or in the list; toggle visibility independently.
- Export STL, OBJ, 3MF, or faceted STEP. **Downloads use original assembled coordinates, include hidden parts, and ignore the viewing explosion.** Suggested figurine regions are open surface patches for inspection. Exports use the original unsplit figurine mesh. STEP export generates planar triangle BREP faces and requires closed, consistently oriented shells with at most 60,000 triangles. Other exports are triangle geometry only. Material/texture metadata and 3MF slicer settings are not round-tripped.
- STL and OBJ have no reliable unit metadata; dimensions are assumed millimeters. 3MF/STEP imports normalize supported units to millimeters.
- Limits: 80 MB file, 1.5 million triangles, 2,500 detected parts. Large geometry imports/exports may briefly stall the browser; STEP import and connectivity analysis use workers. 3MF ZIP metadata is checked against a 200 MB uncompressed limit before parsing.
- The sample pump has seven source bodies. The sample astronaut starts as one connected surface with no part labels and is analyzed by the same worker as uploaded models.

## Hosting

Copy this directory to a folder such as `partlab/` in a GitHub Pages repository. Enable Pages from that branch in the repository Settings if it is not already enabled. Relative local paths and pinned CDN dependencies support project subpaths. No keys or accounts are needed to use the app.

## Dependencies and references

- Three.js 0.180.0, MIT: https://github.com/mrdoob/three.js — viewer and STL/OBJ/3MF loaders (its 3MF loader includes its own bundled fflate import).
- fflate 0.8.2, MIT: https://github.com/101arrowz/fflate — 3MF ZIP export.
- occt-import-js 0.0.23: https://github.com/kovacsv/occt-import-js — browser STEP tessellation, based on Open CASCADE. See upstream licensing for OCCT and this wrapper. Loaded only for STEP imports.
- Fusion navigation reference: https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GUID-F0491540-0324-470A-B651-2238D0EFAC30.htm

## Validation — November 22, 2026

Thirteen Node geometry/export tests passed. Live browser checks loaded the sample and found seven parts; an exported STL was reopened and still yielded seven shells. OBJ, 3MF, and faceted STEP fixtures generated from those same positions all loaded with 516 triangles and matching bounds; 3MF and STEP discovery found seven pieces. The STEP round trip uses the actual browser OCCT parser. This does not validate every vendor's format extensions or guarantee repair of arbitrary meshes.

