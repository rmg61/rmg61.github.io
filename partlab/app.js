import * as THREE from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {ThreeMFLoader} from 'three/addons/loaders/3MFLoader.js';
import {bounds,binarySTL,objText,stepText} from './geometry.js?v=0.1.2';
import {readRegionGLB, trianglePositions} from './region-glb.js?v=0.2.1';
import { defaultFilaments, makeSupportFin } from './print-project.js?v=0.3.0';

const $=id=>document.getElementById(id);
const palette=['#b5f4d5','#8dbbf8','#f3bb84','#c4a4ee','#f28fa0','#ebd882','#79ced4','#b5c5da'];
const viewport=$('viewport'),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.01,100000);
camera.up.set(0,0,1);camera.position.set(140,-170,125);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch(e){$('notice').textContent='WebGL is unavailable. Enable hardware acceleration in your browser and reload.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0,0);viewport.prepend(renderer.domElement);
renderer.domElement.setAttribute('aria-label', 'Interactive 3D model. Drag with the left or right mouse button to orbit. Middle mouse drag pans, Shift plus middle mouse drag orbits, and the wheel zooms. Left click selects a part.');
renderer.domElement.tabIndex = 0;
scene.add(new THREE.HemisphereLight(0xd8ecff,0x53605b,2.5));
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(70,-70,160);scene.add(key);
const fill=new THREE.DirectionalLight(0xa6caff,1.7);fill.position.set(-100,80,60);scene.add(fill);
const model=new THREE.Group();scene.add(model);let grid;
const finGroup = new THREE.Group();
scene.add(finGroup);
const fins = [];
let filaments = [...defaultFilaments], showPrintColors = false, placingFin = false, printFrame;
const target=new THREE.Vector3(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let sources=[],parts=[],isDiscovered=false,selected=-1,modelName='',span=100,busy=false,drag=null,zoomMin=.01,zoomMax=1e7;
let activeWorker=null,workerReject=null;

function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function setBusy(value,label='Working…'){busy=value;$('busy').hidden=!value;$('busy-text').textContent=label;$('file').disabled=value;$('demo').disabled=value;$('figurine').disabled=value;$('empty-demo').disabled=value;$('explode').disabled=value||!sources.length;$('export').disabled=value||!parts.length;$('assemble').disabled=value||!isDiscovered;$('spread').disabled=value||!isDiscovered||parts.length<2;}
function workerJob(path,data,transfer=[]){return new Promise((resolve,reject)=>{const url=new URL(path,import.meta.url);const w=new Worker(url,{type:url.pathname.endsWith('/step-worker.js')?'classic':'module'});activeWorker=w;workerReject=reject;const timer=setTimeout(()=>{w.terminate();activeWorker=null;workerReject=null;reject(new Error('Processing took too long. Try a smaller or simplified file.'));},120000);const end=()=>{clearTimeout(timer);w.terminate();activeWorker=null;workerReject=null;};w.onmessage=e=>{end();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data);};w.onerror=e=>{end();reject(new Error(e.message||'The model processor could not load. Check your internet connection.'));};w.postMessage(data,transfer);});}

const analyzeParts = infer => workerJob('parts-worker.js?v=0.2.0', {
  sources: sources.map(part => ({ name: part.name, positions: trianglePositions(part) })),
  infer
});

const triangleCount = part => part.indices ? part.indices.length / 3 : part.positions.length / 9;

function geometryFromPart(part) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  if (part.indices) geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
  if (part.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
function clearParts(){for(const p of parts){model.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();}parts=[];}
function displayParts(data,discovered=false){
  clearParts();isDiscovered=discovered;selected=-1;$('spread').value=0;$('spread-value').value='0%';
  parts = data.map((part, index) => {
    const color = part.color ?? palette[index % palette.length];
    const geometry = geometryFromPart(part);
    const material = new THREE.MeshStandardMaterial({
      color: discovered ? color : '#a1bbca', metalness: .22, roughness: .46, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.partIndex = index;
    model.add(mesh);
    return { ...part, mesh, color, slot: part.slot ?? 0, center: geometry.boundingBox.getCenter(new THREE.Vector3()), direction: new THREE.Vector3() };
  });
  const box=new THREE.Box3().setFromObject(model);const center=box.getCenter(new THREE.Vector3());const dims=box.getSize(new THREE.Vector3());span=Math.max(...dims.toArray(),.001);zoomMin=span*.005;zoomMax=span*200;
  for(let i=0;i<parts.length;i++){if(parts[i].inferred&&parts[i].name==='Torso')continue;const d=parts[i].center.clone().sub(center);if(d.length()<span*.02){const angle=i*2.399963229728653;d.set(Math.cos(angle),Math.sin(angle),(i%3)-1).multiplyScalar(span*.3);}parts[i].direction.copy(d.normalize());}
  if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}grid=new THREE.GridHelper(span*3,24,0x425867,0x263541);grid.rotation.x=Math.PI/2;grid.position.set(center.x,center.y,box.min.z-span*.025);scene.add(grid);
  document.body.classList.add('has-model');target.copy(center);$('dimensions').textContent=dims.toArray().map(n=>n.toLocaleString(undefined,{maximumFractionDigits:1})).join(' × ');
  printFrame = { origin: [center.x, center.y, box.min.z], center, span };
  if ($('print-setup').hidden) {
    $('print-setup').hidden = false;
    $('print-width').value = parts[0]?.explosionOffset || span > 5000 ? 150 : Math.max(1, Number(span.toFixed(3)));
    renderFilaments();
  }
  $('triangles').textContent=parts.reduce((n,p)=>n+triangleCount(p),0).toLocaleString();$('empty').hidden=true;$('file-card').hidden=false;$('filename').textContent=modelName;$('model-badge').textContent=parts[0]?.explosionOffset?'NAMED REGIONS':parts.some(p=>p.inferred)?'SUGGESTED REGIONS':discovered?'PARTS DISCOVERED':'MODEL LOADED';renderPartList();fitView();
}

function fitView(view){if(!parts.length){camera.lookAt(target);return;}const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),radius=box.getSize(new THREE.Vector3()).length()/2;let dir=camera.position.clone().sub(target).normalize();if(view==='iso')dir.set(1,-1.35,.95).normalize();if(view==='front')dir.set(0,-1,0);if(view==='top')dir.set(0,-.00001,1).normalize();if(view==='right')dir.set(1,0,0);const fov=Math.min(camera.fov*Math.PI/180,2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect));const distance=radius/Math.sin(fov/2)*1.2;target.copy(center);camera.position.copy(center).addScaledVector(dir,Math.max(distance,.01));camera.near=Math.max(span/10000,.000001);camera.far=Math.max(distance*100,span*1000);camera.updateProjectionMatrix();camera.lookAt(target);}
function spreadParts() {
  const amount = Number($('spread').value) / 100;
  if (amount && placingFin) setFinMode(false);
  finGroup.visible = amount === 0;
  $('spread-value').value = Math.round(amount * 100) + '%';
  for (const part of parts) {
    if (part.explosionOffset) part.mesh.position.fromArray(part.explosionOffset).multiplyScalar(amount);
    else part.mesh.position.copy(part.direction).multiplyScalar(span * .6 * amount);
  }
  if (grid) grid.position.z = new THREE.Box3().setFromObject(model).min.z - span * .025;
}
function renderPartList(){
  $('parts').replaceChildren();$('part-count').textContent=isDiscovered?parts.length:0;$('show-all').hidden=!isDiscovered;$('isolate-part').hidden=!isDiscovered;$('isolate-part').disabled=selected<0;$('parts-hint').textContent=isDiscovered?'Click to select · Hide to inspect inside.':'Run discovery to identify geometric pieces.';
  parts.forEach((p,i)=>{const card=document.createElement('div');card.className='part'+(selected===i?' selected':'')+(!p.mesh.visible?' is-hidden':'');const swatch=document.createElement('span');swatch.className='part-color';swatch.style.background=showPrintColors?filaments[p.slot]:p.color;const choose=document.createElement('button');choose.className='part-select';choose.title=p.name;choose.setAttribute('aria-pressed',String(selected===i));const name=document.createElement('strong');name.textContent=p.name||`Part ${i+1}`;const detail=document.createElement('small');detail.textContent=triangleCount(p).toLocaleString()+' triangles';choose.append(name,detail);choose.onclick=()=>selectPart(i);const eye=document.createElement('button');eye.className='visibility';eye.textContent=p.mesh.visible?'Hide':'Show';eye.setAttribute('aria-label',`${p.mesh.visible?'Hide':'Show'} ${p.name}`);eye.onclick=()=>{p.mesh.visible=!p.mesh.visible;renderPartList();};card.append(swatch,choose,eye,filamentSelect(p));$('parts').append(card);});
}
function selectPart(i){selected=i;parts.forEach((p,k)=>{p.mesh.material.emissive.set(k===i?'#264d40':'#000000');p.mesh.material.emissiveIntensity=k===i?.8:0;});renderPartList();}

function extract(root){root.updateMatrixWorld(true);const out=[];let triangles=0;root.traverse(child=>{if(!child.isMesh)return;const g=child.geometry,pos=g.getAttribute('position'),index=g.index;if(!pos)return;const count=index?index.count:pos.count;if(count%3)throw new Error('The model has incomplete triangles.');triangles+=count/3;if(triangles>1500000)throw new Error('This prototype supports up to 1.5 million triangles.');const a=new Float32Array(count*3),v=new THREE.Vector3();for(let i=0;i<count;i++){v.fromBufferAttribute(pos,index?index.getX(i):i).applyMatrix4(child.matrixWorld);if(!Number.isFinite(v.x+v.y+v.z))throw new Error('Invalid coordinates in this model.');v.toArray(a,i*3);}if(a.length)out.push({name:child.name||`Body ${out.length+1}`,positions:a});});return out;}
function validate(data){if(!data.length)throw new Error('No triangle geometry was found in the file.');let n=0;for(const p of data){if(p.positions.length%9)throw new Error('Incomplete triangle geometry.');n+=p.positions.length/9;for(const v of p.positions)if(!Number.isFinite(v))throw new Error('Invalid model coordinates.');}if(n>1500000)throw new Error('Maximum 1.5 million triangles per model.');if(n===0)throw new Error('The model is empty.');}

async function loadFile(file){
  if(busy)return;const ext=file.name.split('.').pop().toLowerCase();if(!['stl','obj','3mf','step','stp','glb'].includes(ext)){notice('Choose an STL, OBJ, 3MF, STEP, or PartLab region GLB file.',true);return;}if(file.size>80*1024*1024){notice('This prototype accepts files up to 80 MB.',true);return;}
  setBusy(true,ext==='step'||ext==='stp'?'Reading STEP bodies…':'Loading model…');
  try{const buffer=await file.arrayBuffer();let data;
    if (ext === 'glb') {
      data = readRegionGLB(buffer);
      resetPrintSetup();
      sources = data;
      modelName = file.name;
      displayParts(data, true);
      $('file-kind').textContent = 'PARTLAB REGION GLB';
      $('units-label').textContent = 'source dimensions';
      showPreparedExplosion(true);
      return;
    }
    if(ext==='stl'){const g=new STLLoader().parse(buffer);const root=new THREE.Mesh(g);root.name='Mesh';data=extract(root);g.dispose();}
    else if(ext==='obj'){const root=new OBJLoader().parse(new TextDecoder().decode(buffer));data=extract(root);disposeImported(root);}
    else if(ext==='3mf'){// Check expanded package sizes before ThreeMFLoader decompresses the archive.
      checkZipSize(buffer);const root=new ThreeMFLoader().parse(buffer);data=extract(root);disposeImported(root);
    }else ({ parts: data } = await workerJob('step-worker.js', buffer, [buffer]));
    validate(data);resetPrintSetup();sources=data;modelName=file.name;displayParts(sources);$('file-kind').textContent=ext.toUpperCase()+' MODEL';$('units-label').textContent=['stl','obj'].includes(ext)?'dimensions · mm assumed':'dimensions · mm';notice('Model loaded. Select “Explode into parts” to find its separate geometric pieces.');
  }catch(e){notice('Could not open model: '+e.message,true);}finally{setBusy(false);$('file').value='';}
}
function disposeImported(root){root.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});}
function checkZipSize(buffer){const dv=new DataView(buffer);let total=0,entries=0;for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--){if(dv.getUint32(i,true)!==0x06054b50)continue;const count=dv.getUint16(i+10,true);let at=dv.getUint32(i+16,true);for(let k=0;k<count;k++){if(at+46>buffer.byteLength||dv.getUint32(at,true)!==0x02014b50)throw new Error('Invalid 3MF archive.');total+=dv.getUint32(at+24,true);entries++;if(total>200*1024*1024||entries>10000)throw new Error('Expanded 3MF package is too large (200 MB limit).');at+=46+dv.getUint16(at+28,true)+dv.getUint16(at+30,true)+dv.getUint16(at+32,true);}return;}throw new Error('Not a supported 3MF ZIP archive.');}

async function discover() {
  if (busy || !sources.length) return;
  if (sources[0].explosionOffset) {
    parts.forEach(part => { part.mesh.visible = true; });
    renderPartList();
    showPreparedExplosion();
    return;
  }
  if (isDiscovered) {
    $('spread').value = parts.some(part => part.inferred) ? 40 : parts.length > 1 ? 70 : 0;
    spreadParts();
    fitView();
    return;
  }
  if (fins.length) {
    notice('Undo the placed fins before discovering new parts. Place them again after discovery so each fin follows the correct color.', true);
    return;
  }
  setBusy(true, 'Analyzing the model…');
  try {
    const result = await analyzeParts(true);
    const assigned = new Map(parts.map(part => [part.name, part.slot]));
    const oneSlot = parts.length === 1 ? parts[0].slot : 0;
    displayParts(result.parts.map(part => ({ ...part, slot: assigned.get(part.name) ?? oneSlot })), true);
    updatePrintColors();
    $('spread').value = result.segmentation === 'figurine' ? 40 : parts.length > 1 ? 70 : 0;
    spreadParts();
    fitView();
    if (result.segmentation === 'figurine') {
      notice('6 suggested regions in one connected mesh. Select or hide them to inspect. Exports use the original assembled geometry.');
    } else if (result.segmentation === 'too-large') {
      notice(`One connected piece. Figurine analysis supports up to ${result.figurineTriangleLimit.toLocaleString()} triangles.`);
    } else if (result.segmentation === 'no-match') {
      notice('One connected piece. PartLab found no clear figurine landmarks to suggest a split.');
    } else {
      notice(`${parts.length.toLocaleString()} geometric parts found. Adjust spacing, select a part, or hide parts to look inside.`);
    }
  } catch (error) {
    notice('Part discovery failed: ' + error.message, true);
  } finally {
    setBusy(false);
  }
}

function showPreparedExplosion(useFront = false) {
  $('spread').value = 84;
  spreadParts();
  fitView(useFront ? 'front' : undefined);
  notice(`${parts.length} named regions loaded. Adjust spacing or select and isolate a region. Cut edges are open for inspection.`);
}

function demo(){if(busy)return;const root=new THREE.Group();const add=(g,name,x,y,z)=>{const mesh=new THREE.Mesh(g);mesh.name=name;mesh.position.set(x,y,z);root.add(mesh);};
  add(new THREE.BoxGeometry(92,64,8),'Mounting base',0,0,0);add(new THREE.BoxGeometry(64,46,35),'Housing',0,0,24);add(new THREE.BoxGeometry(70,52,7),'Top cover',0,0,46);add(new THREE.CylinderGeometry(8,8,11,24),'Left fastener',-23,-16,55);root.children.at(-1).rotation.x=Math.PI/2;add(new THREE.CylinderGeometry(8,8,11,24),'Right fastener',23,16,55);root.children.at(-1).rotation.x=Math.PI/2;add(new THREE.CylinderGeometry(13,13,26,36),'Inlet',-45,0,25);root.children.at(-1).rotation.z=Math.PI/2;add(new THREE.CylinderGeometry(10,10,25,36),'Outlet',0,-33,25);
  resetPrintSetup();sources=extract(root);disposeImported(root);modelName='Sample pump assembly';displayParts(sources);$('file-kind').textContent='SAMPLE · 7 SOURCE BODIES';$('units-label').textContent='dimensions · mm';setBusy(false);notice('Sample assembly loaded. Try “Explode into parts” to separate its seven bodies.');
}

async function loadFigurine() {
  if (busy) return;
  setBusy(true, 'Building the figurine…');
  try {
    const { makeFigurine } = await import('./figurine-sample.js?v=0.2.0');
    resetPrintSetup();
    sources = [{ name: 'Astronaut', positions: makeFigurine() }];
    modelName = 'Sample astronaut figurine';
    displayParts(sources);
    fitView('front');
    $('file-kind').textContent = 'SAMPLE · ONE CONNECTED MESH';
    $('units-label').textContent = 'dimensions · mm';
    notice('One-piece figurine loaded. Select “Explode into parts” to see the suggested regions.');
  } catch (error) {
    notice('Could not load the figurine: ' + error.message, true);
  } finally {
    setBusy(false);
  }
}

function exportParts() {
  // Suggested regions are open surface patches. Preserve the input mesh for export.
  const exportGeometry = parts.some(part => part.inferred) ? sources : parts;
  return exportGeometry.map(part => ({ name: part.name, positions: trianglePositions(part) }));
}

function renderFilaments() {
  const list = $('filaments');
  list.replaceChildren();
  filaments.forEach((color, slot) => {
    const label = document.createElement('label');
    label.textContent = `${slot + 1}`;
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = color;
    picker.setAttribute('aria-label', `Filament ${slot + 1} color`);
    picker.oninput = () => {
      filaments[slot] = picker.value;
      showPrintColors = true;
      updatePrintColors();
    };
    label.append(picker);
    list.append(label);
  });
}

function filamentSelect(part) {
  const select = document.createElement('select');
  select.className = 'filament-slot';
  select.setAttribute('aria-label', `Filament slot for ${part.name}`);
  filaments.forEach((_, slot) => select.add(new Option(`Filament ${slot + 1}`, String(slot))));
  select.value = String(part.slot);
  select.onchange = () => {
    part.slot = Number(select.value);
    showPrintColors = true;
    updatePrintColors();
  };
  return select;
}

function updatePrintColors() {
  $('paint-view').setAttribute('aria-pressed', String(showPrintColors));
  $('paint-view').textContent = showPrintColors ? 'Show region colors' : 'Show print colors';
  const swatches = $('parts').querySelectorAll('.part-color');
  parts.forEach((part, index) => {
    part.mesh.material.color.set(showPrintColors ? filaments[part.slot] : isDiscovered ? part.color : '#a1bbca');
    if (swatches[index]) swatches[index].style.background = showPrintColors ? filaments[part.slot] : part.color;
  });
  for (const fin of fins) fin.mesh.material.color.set(showPrintColors ? filaments[fin.part.slot] : '#cb8e54');
}

function resetPrintSetup() {
  while (fins.length) removeLastFin();
  filaments = [...defaultFilaments];
  showPrintColors = false;
  updatePrintColors();
  setFinMode(false);
  $('print-setup').hidden = true;
}

function printScale() {
  const field = $('print-width');
  if (!field.checkValidity() || !(field.valueAsNumber > 0)) throw new Error('Enter a model dimension from 1 to 5,000 mm.');
  return field.valueAsNumber / printFrame.span;
}

function setFinMode(active) {
  placingFin = active;
  document.body.classList.toggle('placing-fin', active);
  $('add-fin').setAttribute('aria-pressed', String(active));
  $('add-fin').textContent = active ? 'Done placing' : 'Place fin';
}

function removeLastFin() {
  const fin = fins.pop();
  if (fin) {
    finGroup.remove(fin.mesh);
    fin.mesh.geometry.dispose();
    fin.mesh.material.dispose();
  }
  $('undo-fin').disabled = !fins.length;
  $('print-width').disabled = fins.length > 0;
  $('fin-count').textContent = fins.length ? `${fins.length} placed` : 'No fins placed.';
}

function placeSupport(hit) {
  try {
    const normal = hit?.face?.normal?.clone().transformDirection(hit.object.matrixWorld);
    if (!normal || normal.z > -.15) throw new Error('Click a downward-facing surface. Orbit below the part to find the underside.');
    const part = parts[hit.object.userData.partIndex];
    const scale = printScale();
    const anchor = hit.point.toArray();
    const bed = printFrame.origin[2];
    const settings = ['fin-foot','fin-thickness','fin-gap','fin-angle'].map(id => {
      const field = $(id);
      if (!field.checkValidity() || !Number.isFinite(field.valueAsNumber)) throw new Error('Enter valid fin dimensions and angle.');
      return field.valueAsNumber;
    });
    const [footprint, thickness, gap, angleDegrees] = settings;
    const angle = Math.atan2(anchor[1] - printFrame.center.y, anchor[0] - printFrame.center.x) + THREE.MathUtils.degToRad(angleDegrees);
    const data = makeSupportFin({ anchor, bed, scale, angle, footprint, thickness, gap });
    const usableMeshes = parts.map(candidate => candidate.mesh);
    const probe = new THREE.Raycaster();
    const sampleZ = Math.max(bed, anchor[2] - (gap + 1.5) / scale);
    // Check several columns along the fin web. Final contact and toolpaths can be inspected in the slicer.
    for (const distance of [1, (footprint + 1.5) / 2, footprint - .65]) {
      for (const side of [-thickness / 2, 0, thickness / 2]) {
        const x = anchor[0] + (Math.cos(angle) * distance - Math.sin(angle) * side) / scale;
        const y = anchor[1] + (Math.sin(angle) * distance + Math.cos(angle) * side) / scale;
        probe.set(new THREE.Vector3(x, y, bed - .2 / scale), new THREE.Vector3(0, 0, 1));
        const near = probe.intersectObjects(usableMeshes)[0];
        if (near && near.point.z < sampleZ) throw new Error('The fin path crosses the model. Change its foot angle or choose another underside.');
      }
    }
    const mesh = new THREE.Mesh(geometryFromPart(data), new THREE.MeshStandardMaterial({ color: '#cb8e54', roughness: .8, side: THREE.DoubleSide }));
    finGroup.add(mesh);
    fins.push({ ...data, name: `Support fin ${fins.length + 1}`, part, mesh });
    $('undo-fin').disabled = false;
    $('print-width').disabled = true;
    $('fin-count').textContent = `${fins.length} placed`;
    updatePrintColors();
    notice(`Fin ${fins.length} placed under ${part.name}. Click another underside or choose Done placing.`);
  } catch (error) {
    notice(error.message, true);
  }
}

async function makePrint3MF() {
  const scale = printScale();
  const fileParts = parts.map(({ name, positions, indices, slot }) => ({ name, positions, indices, slot }));
  const fileFins = fins.map(({ name, positions, indices, part }) => ({ name, positions, indices, slot: part.slot }));
  return workerJob('print-worker.js?v=0.3.0', {
    name: modelName.replace(/\.[^.]+$/, ''), parts: fileParts, fins: fileFins, filaments,
    scale, origin: printFrame.origin, fused: parts.some(part => part.inferred || part.explosionOffset)
  });
}
async function exportModel() {
  if (busy || !parts.length) return;
  setBusy(true, 'Preparing download…');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const format = $('format').value;
    let payload, type = 'application/octet-stream', message = 'Model downloaded in original assembled coordinates.';
    if (format === 'stl') payload = binarySTL(exportParts());
    if (format === 'obj') { payload = objText(exportParts()); type = 'text/plain'; }
    if (format === 'step') {
      const { parts: shells } = await analyzeParts(false);
      payload = stepText(shells);
      type = 'application/step';
      message = 'Faceted STEP downloaded.';
    }
    if (format === '3mf') {
      const { bytes, warnings } = await makePrint3MF();
      payload = bytes;
      type = 'model/3mf';
      const topology = warnings.open || warnings.irregular ? ` Mesh needs a slicer check: ${warnings.open.toLocaleString()} open edges and ${warnings.irregular.toLocaleString()} irregular edges.` : '';
      const capacity = filaments.length > 32 ? ' Slots above 32 use standard 3MF colors only.' : '';
      message = `3MF exported with filament colors and ${fins.length} support fin${fins.length === 1 ? '' : 's'}. Match filament slots and preview the slice.${topology}${capacity}`;
    }
    const url = URL.createObjectURL(new Blob([payload], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (modelName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_') || 'model') + '.' + format;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice(message);
  } catch (error) {
    notice('Export failed: ' + error.message, true);
  } finally {
    setBusy(false);
  }
}

// A short left click selects a part. A drag can start anywhere in the canvas.
const canvas = renderer.domElement;
const orbitDragThreshold = 5;

canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (drag || ![0, 1, 2].includes(event.button)) return;
  if (event.button !== 0) event.preventDefault();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId,
    button: event.button,
    orbit: event.button !== 1 || event.shiftKey,
    moved: false,
    x: event.clientX,
    y: event.clientY
  };
});

canvas.addEventListener('pointermove', event => {
  if (drag?.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (drag.button === 0 && !drag.moved && Math.hypot(dx, dy) < orbitDragThreshold) return;
  if (dx === 0 && dy === 0) return;

  drag.moved = true;
  drag.x = event.clientX;
  drag.y = event.clientY;
  const offset = camera.position.clone().sub(target);
  const radius = offset.length();
  if (drag.orbit) {
    const theta = Math.atan2(offset.y, offset.x) - dx * .007;
    const initialPhi = Math.acos(THREE.MathUtils.clamp(offset.z / radius, -1, 1));
    const phi = THREE.MathUtils.clamp(initialPhi - dy * .007, .003, Math.PI - .003);
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.sin(phi) * Math.sin(theta),
      target.z + radius * Math.cos(phi)
    );
  } else {
    const scale = 2 * radius * Math.tan(camera.fov * Math.PI / 360) / canvas.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const delta = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
    camera.position.add(delta);
    target.add(delta);
  }
  camera.lookAt(target);
});

canvas.addEventListener('pointerup', event => {
  if (drag?.pointerId !== event.pointerId) return;
  const movement = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
  const shouldSelect = drag.button === 0 && !drag.moved && movement < orbitDragThreshold;
  drag = null;
  if (!shouldSelect || (!isDiscovered && !placingFin)) return;

  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  raycaster.setFromCamera(pointer, camera);
  const visibleMeshes = parts.filter(part => part.mesh.visible).map(part => part.mesh);
  const [hit] = raycaster.intersectObjects(visibleMeshes);
  if (placingFin) { placeSupport(hit); return; }
  selectPart(hit?.object.userData.partIndex ?? -1);
});

function cancelDrag(event) {
  if (drag?.pointerId === event.pointerId) drag = null;
}
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('lostpointercapture', cancelDrag);
canvas.addEventListener('auxclick',e=>e.preventDefault());canvas.addEventListener('dblclick',e=>{if(e.button===1)fitView();});canvas.addEventListener('wheel',e=>{e.preventDefault();const offset=camera.position.clone().sub(target),distance=THREE.MathUtils.clamp(offset.length()*Math.exp(Math.max(-500,Math.min(500,e.deltaY))*.001),zoomMin,zoomMax);camera.position.copy(target).add(offset.setLength(distance));camera.lookAt(target);},{passive:false});
new ResizeObserver(()=>{camera.aspect=Math.max(1,viewport.clientWidth)/Math.max(1,viewport.clientHeight);camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);}).observe(viewport);
renderer.setAnimationLoop(()=>{camera.lookAt(target);renderer.render(scene,camera);});
$('file').addEventListener('change',e=>{if(e.target.files[0])loadFile(e.target.files[0]);});$('demo').onclick=demo;$('figurine').onclick=loadFigurine;$('empty-demo').onclick=loadFigurine;$('explode').onclick=discover;$('spread').oninput=spreadParts;$('assemble').onclick=()=>{$('spread').value=0;spreadParts();fitView();notice('Assembled view restored.');};$('fit').onclick=()=>fitView();$('show-all').onclick=()=>{parts.forEach(p=>p.mesh.visible=true);renderPartList();};$('export').onclick=exportModel;
$('isolate-part').onclick = () => {
  parts.forEach((part, index) => { part.mesh.visible = index === selected; });
  renderPartList();
};
$('add-filament').onclick = () => {
  filaments.push(defaultFilaments[filaments.length % defaultFilaments.length]);
  renderFilaments();
  renderPartList();
  $('filaments').lastElementChild.firstElementChild.focus();
};
$('slot-each').onclick = () => {
  if (!parts.length) return;
  filaments = parts.map(part => '#' + new THREE.Color(part.color).getHexString());
  parts.forEach((part, index) => { part.slot = index; });
  showPrintColors = true;
  renderFilaments();
  renderPartList();
  updatePrintColors();
  notice(`${filaments.length} separate filament slots assigned. Edit each color in Print setup.`);
};
$('paint-view').onclick = () => { showPrintColors = !showPrintColors; updatePrintColors(); };
$('undo-fin').onclick = removeLastFin;
$('add-fin').onclick = () => {
  if (placingFin) { setFinMode(false); notice(`${fins.length} support fins in the assembled view.`); return; }
  if (!parts.length || busy) return;
  $('spread').value = 0;
  parts.forEach(part => { part.mesh.visible = true; });
  renderPartList();
  spreadParts();
  fitView();
  setFinMode(true);
  notice('Fin placement active. Orbit below the model and click a downward-facing surface.');
};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>fitView(b.dataset.view));
window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))fitView();});
let dragDepth=0;window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragging');});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('dragleave',e=>{if(--dragDepth<=0)document.body.classList.remove('dragging');});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');if(e.dataTransfer.files.length!==1){notice('Please load one model at a time.',true);return;}loadFile(e.dataTransfer.files[0]);});
window.addEventListener('beforeunload',()=>{activeWorker?.terminate();workerReject?.(new Error('Cancelled'));});
window.partlabReady=true;
