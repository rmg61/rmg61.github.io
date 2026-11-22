// Pure geometry routines shared by the UI, worker, and Node tests.
export function splitConnected(positions, tolerance = 1e-6) {
  if (positions.length % 9) throw new Error('Incomplete triangle data.');
  const count = positions.length / 9;
  if (count > 1500000) throw new Error('This prototype supports up to 1.5 million triangles.');
  const parent = new Int32Array(count); const size = new Int32Array(count).fill(1);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const join = (a,b) => { a=find(a);b=find(b);if(a===b)return;if(size[a]<size[b])[a,b]=[b,a];parent[b]=a;size[a]+=size[b]; };
  const vertices = new Map(), edges = new Map(); let next=0;
  for(let t=0;t<count;t++) {
    const ids=[];
    for(let v=0;v<3;v++) {
      const j=t*9+v*3;const x=positions[j],y=positions[j+1],z=positions[j+2];
      if(!Number.isFinite(x+y+z))throw new Error('The model contains invalid coordinates.');
      const key=`${Math.round(x/tolerance)},${Math.round(y/tolerance)},${Math.round(z/tolerance)}`;
      if(!vertices.has(key))vertices.set(key,next++);ids.push(vertices.get(key));
    }
    for(let e=0;e<3;e++){let a=ids[e],b=ids[(e+1)%3];if(a===b)continue;if(a>b)[a,b]=[b,a];const key=`${a},${b}`;if(edges.has(key))join(t,edges.get(key));else edges.set(key,t);}
  }
  const groups=new Map();for(let t=0;t<count;t++){const root=find(t);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(t);}
  return [...groups.values()].sort((a,b)=>b.length-a.length).map(ts=>{const out=new Float32Array(ts.length*9);for(let i=0;i<ts.length;i++)out.set(positions.subarray(ts[i]*9,ts[i]*9+9),i*9);return out;});
}

export function bounds(positions){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){const k=i%3;min[k]=Math.min(min[k],positions[i]);max[k]=Math.max(max[k],positions[i]);}return{min,max,center:min.map((v,i)=>(v+max[i])/2),size:min.map((v,i)=>max[i]-v)};}

export function normal(p,i){const ax=p[i+3]-p[i],ay=p[i+4]-p[i+1],az=p[i+5]-p[i+2],bx=p[i+6]-p[i],by=p[i+7]-p[i+1],bz=p[i+8]-p[i+2];let n=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];const l=Math.hypot(...n)||1;return n.map(v=>v/l);}

export function binarySTL(parts){const count=parts.reduce((s,p)=>s+p.positions.length/9,0),out=new ArrayBuffer(84+count*50),dv=new DataView(out);new Uint8Array(out).set(new TextEncoder().encode('PartLab binary STL - dimensions assumed millimeters'));dv.setUint32(80,count,true);let o=84;for(const part of parts)for(let i=0;i<part.positions.length;i+=9){for(const n of normal(part.positions,i)){dv.setFloat32(o,n,true);o+=4;}for(let j=0;j<9;j++){dv.setFloat32(o,part.positions[i+j],true);o+=4;}dv.setUint16(o,0,true);o+=2;}return out;}

export function objText(parts){let offset=1;const lines=['# PartLab OBJ export; coordinates in millimeters; geometry only'];for(let k=0;k<parts.length;k++){const p=parts[k].positions;lines.push(`o Part_${k+1}`);for(let i=0;i<p.length;i+=3)lines.push(`v ${p[i]} ${p[i+1]} ${p[i+2]}`);for(let i=0;i<p.length/3;i+=3)lines.push(`f ${offset+i} ${offset+i+1} ${offset+i+2}`);offset+=p.length/3;}return lines.join('\n');}

export function meshXML(parts){const objects=parts.map((part,k)=>{const p=part.positions;let verts='',tris='';for(let i=0;i<p.length;i+=3)verts+=`<vertex x="${p[i]}" y="${p[i+1]}" z="${p[i+2]}"/>`;for(let i=0;i<p.length/3;i+=3)tris+=`<triangle v1="${i}" v2="${i+1}" v3="${i+2}"/>`;return `<object id="${k+1}" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object>`;}).join('');return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objects}</resources><build>${parts.map((_,k)=>`<item objectid="${k+1}"/>`).join('')}</build></model>`;}

// STEP AP214 faceted BREP. Export only closed, consistently wound triangle shells.
// This deliberately does not claim to reconstruct analytic CAD surfaces or features.
export function stepText(parts){
  const count=parts.reduce((n,p)=>n+p.positions.length/9,0);
  if(count>60000)throw new Error('Faceted STEP export is limited to 60,000 triangles. Choose STL, OBJ, or 3MF for this model.');
  const entities=[];const add=s=>{entities.push(`#${entities.length+1}=${s};`);return `#${entities.length}`;};
  const app=add("APPLICATION_CONTEXT('automotive design')");add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const pc=add(`PRODUCT_CONTEXT('',${app},'mechanical')`),prod=add(`PRODUCT('PartLab','PartLab','Faceted mesh export',(${pc}))`),formation=add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`),dc=add(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`),definition=add(`PRODUCT_DEFINITION('design','',${formation},${dc})`),shape=add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm=add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))"),rad=add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))"),sr=add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())"),unc=add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),${mm},'distance_accuracy_value','')`),ctx=add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`);
  const items=[];
  for(const part of parts){const p=part.positions,vertex=new Map(),ids=[],edges=new Map();
    for(let i=0;i<p.length;i+=3){const key=[p[i],p[i+1],p[i+2]].map(v=>v.toPrecision(9)).join(',');if(!vertex.has(key))vertex.set(key,{id:add(`CARTESIAN_POINT('',(${[p[i],p[i+1],p[i+2]].map(stepNumber).join(',')}))`),index:vertex.size});ids.push(vertex.get(key));}
    const faces=[];for(let i=0;i<ids.length;i+=3){for(let j=0;j<3;j++){const a=ids[i+j].index,b=ids[i+(j+1)%3].index;if(a===b)throw new Error('STEP export found a degenerate face.');const key=`${Math.min(a,b)},${Math.max(a,b)}`;const e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}const loop=add(`POLY_LOOP('',(${ids.slice(i,i+3).map(v=>v.id).join(',')}))`),bound=add(`FACE_OUTER_BOUND('',${loop},.T.)`);faces.push(add(`FACE('',(${bound}))`));}
    if([...edges.values()].some(([n,d])=>n!==2||d!==0))throw new Error('STEP needs closed, consistently oriented shells. This model has open or non-manifold geometry. Export STL, OBJ, or 3MF instead.');
    const shell=add(`CLOSED_SHELL('',(${faces.join(',')}))`);items.push(add(`FACETED_BREP('Part ${items.length+1}',${shell})`));
  }
  const rep=add(`FACETED_BREP_SHAPE_REPRESENTATION('',(${items.join(',')}),${ctx})`);add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${rep})`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('PartLab faceted geometry; no feature history'),'2;1');\nFILE_NAME('model.step','${new Date().toISOString()}',(''),(''),'PartLab','PartLab','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${entities.join('\n')}\nENDSEC;\nEND-ISO-10303-21;`;
}
function stepNumber(v){let s=Number(v).toPrecision(12).replace('e','E');return s.includes('.')||s.includes('E')?s:s+'.';}
