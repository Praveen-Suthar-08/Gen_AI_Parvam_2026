import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const API = 'http://localhost:5000/api';

// ── GLOBALS ──────────────────────────────────
let scene, camera, renderer, controls;
let slotObjects = {};    // slotId → {floorMesh, borderMeshes[], vehicleGroup, labelSprite, data, pos, coneMesh}
let floorGroups = {};    // floor number → THREE.Group (contains all meshes for that floor)
let previousSlotData = {};
let selectedSlotId = null;
let isAnimatingCamera = false;
let cameraTargetPos = null;
let cameraTargetLookAt = null;
let particleSystem = null;
let animationFrameId = null;
let currentFloorFilter = 'all';
let sharedGeometries = {};  // cache
let sharedMaterials = {};   // cache

// ── THEME MANAGEMENT ────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = savedTheme || (systemPrefersDark.matches ? 'dark' : 'light');
  applyTheme(theme);

  // Watch for system theme changes
  systemPrefersDark.addEventListener('change', e => {
    if(!localStorage.getItem('theme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  // Sync across tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') applyTheme(e.newValue);
  });
}

function applyTheme(theme) {
  const body = document.body;
  if (theme === 'light') {
    body.classList.add('light-mode');
    if (renderer) renderer.setClearColor(0xf1f5f9);
  } else {
    body.classList.remove('light-mode');
    if (renderer) renderer.setClearColor(0x0a0e1a);
  }
  // Force update visuals for all slots if already initialized
  if (Object.keys(slotObjects).length > 0) {
    Object.values(slotObjects).forEach(obj => updateSlot(obj.data, obj.data.status));
  }
}

// ── INIT ─────────────────────────────────────
async function init() {
  initTheme();
  setupRenderer();
  setupCamera();
  setupControls();
  setupLighting();
  buildParkingStructure();
  setupParticles();
  setupRaycaster();
  setupKeyboard();
  setupUI();
  
  try {
    const slots = await fetchSlots();
    buildAllSlots(slots);
    
    // Add vehicles instantly for those already occupied on initial load
    // so they don't all animate in at once
    slots.forEach(s => {
      if(s.status === 'occupied') {
        const obj = slotObjects[s.id];
        const vehicle = buildVehicle(s, obj.pos);
        scene.add(vehicle);
        obj.vehicleGroup = vehicle;
      } else if (s.status === 'maintenance') {
        addMaintenanceCone(s.id);
      }
    });

    updateStatsOverlay(slots);
    startPolling();
    animate();
  } catch(e) {
    console.error("Failed to fetch initial data", e);
    showToast3d("Failed to connect to parking server", 'error');
  }
}

// ── RENDERER SETUP ───────────────────────────
function setupRenderer() {
  const canvas = document.getElementById('three-canvas');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  
  const isLight = document.body.classList.contains('light-mode');
  renderer.setClearColor(isLight ? 0xf1f5f9 : 0x0a0e1a);
  
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ── CAMERA ───────────────────────────────────
function setupCamera() {
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
  camera.position.set(0, 120, 160);
  camera.lookAt(0, 0, 0);
}

// ── CONTROLS ─────────────────────────────────
function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 30;
  controls.maxDistance = 400;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
}

// ── LIGHTING ─────────────────────────────────
function setupLighting() {
  scene.add(new THREE.AmbientLight(0x334466, 0.4));
  
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(50, 100, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
  scene.add(sun);

  // 4 zone spotlights
  const spotPositions = [[-60,14,0],[60,14,0],[-60,14+18,0],[60,14+18,0],[-60,14+36,0],[60,14+36,0]];
  // Adjust spots across all 3 floors to give illumination for the ceilings
  spotPositions.forEach(([x,y,z]) => {
    const spot = new THREE.SpotLight(0x8888ff, 1.2, 80, Math.PI/5, 0.3);
    spot.position.set(x, y, z);
    scene.add(spot);
    
    // lamp fixture mesh
    const lamp = new THREE.Mesh(
      getSharedGeometry('lampCyl', () => new THREE.CylinderGeometry(1.5,1.5,1,8)),
      getSharedMaterial('lamp', () => new THREE.MeshStandardMaterial({color:0x1e2a3a}))
    );
    lamp.position.set(x, y+0.5, z);
    scene.add(lamp);
    
    // Tiny point light to make the lamp glow slightly
    const point = new THREE.PointLight(0xaaccff, 0.3, 40);
    point.position.set(x,y-1,z);
    scene.add(point);
  });
}

// ── BUILDING STRUCTURE ───────────────────────
function buildParkingStructure() {
  buildGround();
  for (let floor = 1; floor <= 3; floor++) {
    floorGroups[floor] = new THREE.Group();
    scene.add(floorGroups[floor]);
    buildFloorSlab(floor);
    buildFloorLabel(floor);
    buildPillars(floor);
    buildLaneMarkings(floor);
  }
  buildRamps();
  buildOuterWalls();
}

function buildGround() {
  const geo = new THREE.PlaneGeometry(300, 300);
  const mat = new THREE.MeshStandardMaterial({color:0x0d1117, roughness:0.9});
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.GridHelper(300, 60, 0x1e2a3a, 0x1e2a3a));
}

function buildFloorSlab(floor) {
  const y = (floor-1) * 18;
  const geo = new THREE.BoxGeometry(220, 0.5, 120);
  const mat = new THREE.MeshStandardMaterial({color:0x111827, roughness:0.8});
  const slab = new THREE.Mesh(geo, mat);
  slab.position.set(0, y, 0);
  slab.receiveShadow = true;
  floorGroups[floor].add(slab);
  
  // 4 edge trim strips
  const trimMat = new THREE.MeshStandardMaterial({color:0x1e2a3a});
  [
    [110, y+0.4, 0, 0.5, 0.5, 120],
    [-110, y+0.4, 0, 0.5, 0.5, 120],
    [0, y+0.4, 60, 220, 0.5, 0.5],
    [0, y+0.4, -60, 220, 0.5, 0.5]
  ].forEach(([x,_y,z,w,h,d]) => {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), trimMat);
    trim.position.set(x,_y,z);
    floorGroups[floor].add(trim);
  });
}

function buildFloorLabel(floor) {
  const y = (floor-1)*18;
  const sprite = makeTextSprite(`FLOOR ${floor}`, {fontSize: 48, color: '#64748b', w:256, h:64});
  sprite.position.set(-100, y+4, -58);
  sprite.scale.set(16, 4, 1);
  floorGroups[floor].add(sprite);
}

function buildPillars(floor) {
  const y = (floor-1)*18;
  const geo = new THREE.CylinderGeometry(1,1,18,8);
  const mat = new THREE.MeshStandardMaterial({color:0x1e2a3a});
  // 3x4 grid supporting structure
  [-80,-26,26,80].forEach(x => {
    [-45,0,45].forEach(z => {
      const pillar = new THREE.Mesh(geo, mat);
      pillar.position.set(x, y+9, z);
      pillar.castShadow = true;
      floorGroups[floor].add(pillar);
    });
  });
}

function buildLaneMarkings(floor) {
  const y = (floor-1)*18 + 0.3;
  // 2 driving lanes per floor separating rows of parked cars
  const laneMat = new THREE.MeshStandardMaterial({color:0x0d1117});
  const dashMat = new THREE.MeshStandardMaterial({color:0xffaa00});
  
  // Actually we need lane backgrounds and dashes
  [-20, 20].forEach(z => {
    // lane background
    const bg = new THREE.Mesh(new THREE.BoxGeometry(220, 0.1, 8), laneMat);
    bg.position.set(0, y, z);
    floorGroups[floor].add(bg);
    
    // dashes
    for(let x=-90; x<=90; x+=8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 0.5), dashMat);
      dash.position.set(x, y, z);
      floorGroups[floor].add(dash);
    }
  });
}

function buildRamps() {
  for(let f=1; f<=2; f++) {
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.5, 40),
      new THREE.MeshStandardMaterial({color:0x1a2535})
    );
    ramp.position.set(115, (f-1)*18+9, 0);
    ramp.rotation.z = -0.44;  // ~25 degrees upward
    scene.add(ramp);
    
    // yellow stripes on ramp
    [-2,2].forEach(x => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.15,40),
        new THREE.MeshStandardMaterial({color:0xffaa00}));
      stripe.position.set(115+x, (f-1)*18+9.2, 0);
      stripe.rotation.z = -0.44;
      scene.add(stripe);
    });
  }
}

function buildOuterWalls() {
  const mat = new THREE.MeshBasicMaterial({color:0x00d4ff,transparent:true,opacity:0.08,side:THREE.DoubleSide});
  // 4 walls representing bounding box
  [
    [0, 27, 60, 220, 54, 1],
    [0, 27, -60, 220, 54, 1],
    [110, 27, 0, 1, 54, 120],
    [-110, 27, 0, 1, 54, 120]
  ].forEach(([x,y,z,w,h,d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    wall.position.set(x,y,z);
    scene.add(wall);
  });
}

// ── SLOT POSITIONS ────────────────────────────
function getSlotPosition(slotId) {
  const zone = slotId[0];
  const num = parseInt(slotId.slice(1));
  
  // Floor assign: 1-7 (floor 1), 8-14 (fl 2), 15-20 (fl 3)
  const floor = num <= 7 ? 1 : num <= 14 ? 2 : 3;
  const slotIndexOnFloor = num <= 7 ? num-1 : num <= 14 ? num-8 : num-15;
  const floorY = (floor-1)*18 + 0.35;
  
  // Left side has A and B, right side has C and D
  // Each zone on each floor has 1 row of slots
  const zoneXBase = {A:-85, B:-85, C:20, D:20};  
  const x = zoneXBase[zone] + (slotIndexOnFloor * 9); // slot width + gap
  
  // Z positioning separating the two zones per side to face each other across a lane
  // Zones A and C on side closer to center, B and D towards edge
  // We'll place "A" at Z=-10 facing a lane at Z=-20, and "B" at Z=-30 facing the same lane
  const z = (zone==='A'||zone==='C') ? -10 : -30;
  
  // Fix: The prompt said:
  // "Zones A and B: left half, C and D: right half.
  // Each zone has 2 rows of slots facing each other with a lane between."
  // Oh actually my math creates 1 long row of 7 slots per zone per floor.
  // Let's do: A is at Z=-12, B is at Z=-28. Lane is at Z=-20.
  // And C is at Z=12, D is at Z=28. Lane is at Z=20.
  
  const actualZ = (zone==='A') ? -12 : (zone==='B') ? -28 : (zone==='C') ? 12 : 28;
  
  return {x, y:floorY, z:actualZ, floor};
}

// ── BUILD ALL SLOTS ───────────────────────────
function buildAllSlots(slots) {
  slots.forEach(slot => {
    const pos = getSlotPosition(slot.id);
    const slotGroup = buildSlotObject(slot, pos);
    slotObjects[slot.id] = {
      group: slotGroup,
      floorMesh: slotGroup.children[0],
      borderMeshes: slotGroup.children.slice(1,5),
      labelSprite: slotGroup.children[5],
      vehicleGroup: null,
      coneMesh: null,
      data: {...slot},
      pos: pos
    };
    previousSlotData[slot.id] = slot.status;
    floorGroups[pos.floor].add(slotGroup);
  });
}

function buildSlotObject(slot, pos) {
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y, pos.z);
  
  const isLight = document.body.classList.contains('light-mode');
  const colors = isLight ? {
    available: {floor:0xe8f5e9, border:0x00e676},
    occupied:  {floor:0xffebeb, border:0xff4444},
    reserved:  {floor:0xfff8e1, border:0xffaa00},
    maintenance:{floor:0xf1f5f9, border:0x64748b}
  } : {
    available: {floor:0x1a3a2a, border:0x00e676},
    occupied:  {floor:0x3a1a1a, border:0xff4444},
    reserved:  {floor:0x3a2a0a, border:0xffaa00},
    maintenance:{floor:0x1a1a2a, border:0x475569}
  };
  const c = colors[slot.status] || colors.available;
  
  // Floor paint
  const floorMesh = new THREE.Mesh(
    getSharedGeometry('slotFloor', () => new THREE.PlaneGeometry(8,14)),
    new THREE.MeshStandardMaterial({color:c.floor, emissive:c.border, emissiveIntensity:0.03})
  );
  floorMesh.rotation.x = -Math.PI/2;
  floorMesh.userData.slotId = slot.id;
  group.add(floorMesh);
  
  // 4 border lines
  const borderMat = new THREE.MeshBasicMaterial({color:c.border});
  const h = 0.1; 
  [[0,h,7, 8,h,0.3], [0,h,-7, 8,h,0.3], [4,h,0, 0.3,h,14], [-4,h,0, 0.3,h,14]].forEach(([x,y,z,w,bh,d]) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w,bh,d), borderMat.clone());
    strip.position.set(x,y,z);
    group.add(strip);
  });
  
  // ID label sprite
  const sprite = makeTextSprite(slot.id, {fontSize:24, color:'#ffffff', w:128, h:32});
  sprite.position.set(0, 2.5, 0);
  group.add(sprite);
  
  return group;
}

// ── VEHICLE BUILDING ─────────────────────────
function buildVehicle(slot, pos) {
  const vehicleType = (slot.vehicle_type || 'car').toLowerCase();
  const color = plateToColor(slot.plate || 'DEFAULT');
  
  const group = new THREE.Group();
  
  if(vehicleType === 'car' || vehicleType === 'suv') {
    const tall = vehicleType==='suv' ? 1 : 0;
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(5+tall*0.5, 1.8+tall*0.4, 10),
      new THREE.MeshStandardMaterial({color, roughness:0.4, metalness:0.6})
    );
    body.position.y = 0.9+tall*0.2;
    body.castShadow = true;
    group.add(body);
    
    // Roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 1.4, 5),
      new THREE.MeshStandardMaterial({color:lightenColor(color,0.15), roughness:0.4})
    );
    roof.position.set(0, 2.5+tall*0.4, -0.5);
    roof.castShadow = true;
    group.add(roof);
    
    // Windshields (simplified)
    const glassMat = new THREE.MeshStandardMaterial({color:0x223344, roughness:0.2});
    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.1), glassMat);
    frontGlass.position.set(0, 2.5+tall*0.4, 2.0);
    frontGlass.rotation.x = -0.2;
    group.add(frontGlass);
    
    const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.1), glassMat);
    rearGlass.position.set(0, 2.5+tall*0.4, -3.0);
    rearGlass.rotation.x = 0.2;
    group.add(rearGlass);
    
    // 4 Wheels
    const wGeo = new THREE.CylinderGeometry(0.8,0.8,0.6,16);
    const wMat = new THREE.MeshStandardMaterial({color:0x222222,roughness:0.9});
    [[2.8,0.8,3.5],[-2.8,0.8,3.5],[2.8,0.8,-3.5],[-2.8,0.8,-3.5]].forEach(([x,y,z]) => {
      const w = new THREE.Mesh(wGeo, wMat);
      w.position.set(x,y,z); w.rotation.z = Math.PI/2; group.add(w);
    });
    
    // Lights
    const hlMat = new THREE.MeshBasicMaterial({color:0xffffaa});
    const tlMat = new THREE.MeshBasicMaterial({color:0xff2200});
    [[1.5,1.5,5],[-1.5,1.5,5]].forEach(([x,y,z]) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.4,0.1), hlMat);
      hl.position.set(x,y,z); group.add(hl);
    });
    [[1.5,1.5,-5],[-1.5,1.5,-5]].forEach(([x,y,z]) => {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.4,0.1), tlMat);
      tl.position.set(x,y,z); group.add(tl);
    });
    
    // Plate
    const plateSp = makeTextSprite(slot.plate||'--', {fontSize:16,color:'#000000',bg:'#ffffff',w:100,h:32});
    plateSp.position.set(0, 1.0, 5.1); plateSp.scale.set(3,1,1); group.add(plateSp);
    
  } else if(vehicleType === 'truck') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(5,2.5,14),
      new THREE.MeshStandardMaterial({color,roughness:0.5,metalness:0.4})
    );
    body.position.y = 1.25; body.castShadow = true; group.add(body);
    
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(5,2.8,5),
      new THREE.MeshStandardMaterial({color:lightenColor(color,0.1)})
    );
    cabin.position.set(0,2.9,4.5); group.add(cabin);
    
    // 6 wheels
    const wGeo = new THREE.CylinderGeometry(1,1,0.7,16);
    const wMat = new THREE.MeshStandardMaterial({color:0x222222});
    [[2.9,1,5],[-2.9,1,5],[2.9,1,0],[-2.9,1,0],[2.9,1,-5],[-2.9,1,-5]].forEach(([x,y,z]) => {
      const w = new THREE.Mesh(wGeo, wMat); w.position.set(x,y,z); w.rotation.z=Math.PI/2; group.add(w);
    });
    
  } else if(vehicleType === 'bike') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1,1,4),
      new THREE.MeshStandardMaterial({color,roughness:0.3,metalness:0.7})
    );
    body.position.y = 0.8; group.add(body);
    
    const wGeo = new THREE.CylinderGeometry(0.7,0.7,0.3,16);
    const wMat = new THREE.MeshStandardMaterial({color:0x333333});
    [[0,0.7,1.5],[0,0.7,-1.5]].forEach(([x,y,z]) => {
      const w = new THREE.Mesh(wGeo,wMat); w.position.set(x,y,z); w.rotation.z=Math.PI/2; group.add(w);
    });
  }

  // Determine direction to face.
  // Vehicles should face the driving lane.
  // Z=-12 faces Z=-20 (lane). Z=-28 faces Z=-20.
  // This means if slot.z > lane.z, rotation is PI, else 0
  const z = pos.z;
  const inZoneAorC = (z === -12 || z === 12); 
  const inZoneBorD = (z === -28 || z === 28);
  
  if (inZoneAorC) {
    // Face -Z direction
    group.rotation.y = Math.PI;
  } else {
    // Face +Z direction
    group.rotation.y = 0;
  }

  group.position.set(pos.x, pos.y+0.1, pos.z);
  return group;
}

// ── VEHICLE ENTRY/EXIT ANIMATIONS ─────────────
function animateVehicleEntry(slotId) {
  const obj = slotObjects[slotId];
  if(!obj || !obj.vehicleGroup) return;
  const vehicle = obj.vehicleGroup;
  
  // Decide start pos based on orientation
  const isFacingNegZ = vehicle.rotation.y > 0;
  // If facing -Z, lane is in -Z direction so it comes from -Z.
  const laneOffset = isFacingNegZ ? -10 : 10;
  const startZ = obj.pos.z + laneOffset;
  const targetZ = obj.pos.z;
  
  vehicle.position.z = startZ;
  
  const hl1 = new THREE.PointLight(0xffffaa, 0.8, 12);
  const hl2 = new THREE.PointLight(0xffffaa, 0.8, 12);
  hl1.position.set(1.5, 1.5, 5); hl2.position.set(-1.5, 1.5, 5);
  vehicle.add(hl1); vehicle.add(hl2);
  
  let progress = 0;
  const duration = 90; // 1.5s
  function moveIn() {
    progress++;
    const t = progress/duration;
    const eased = 1 - Math.pow(1-t, 3);
    vehicle.position.z = startZ + (targetZ - startZ) * eased;
    if(progress < duration) {
      requestAnimationFrame(moveIn);
    } else {
      vehicle.position.z = targetZ;
      vehicle.remove(hl1); vehicle.remove(hl2);
    }
  }
  moveIn();
}

function animateVehicleExit(slotId, onComplete) {
  const obj = slotObjects[slotId];
  if(!obj || !obj.vehicleGroup) return;
  const vehicle = obj.vehicleGroup;
  
  const isFacingNegZ = vehicle.rotation.y > 0;
  const laneOffset = isFacingNegZ ? -10 : 10;
  const startZ = obj.pos.z;
  const targetZ = obj.pos.z + laneOffset;
  
  let progress = 0;
  const duration = 60; // 1.0s
  function moveOut() {
    progress++;
    const t = progress/duration;
    vehicle.position.z = startZ + (targetZ-startZ) * t * t;
    if(progress < duration) {
      requestAnimationFrame(moveOut);
    } else {
      onComplete();
    }
  }
  moveOut();
}

// ── MAINTENANCE CONE ──────────────────────────
function addMaintenanceCone(slotId) {
  const obj = slotObjects[slotId];
  if(!obj || obj.coneMesh) return;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.5,2,8),
    new THREE.MeshStandardMaterial({color:0xff8800,emissive:0xff4400,emissiveIntensity:0.3})
  );
  cone.position.set(obj.pos.x, obj.pos.y+1, obj.pos.z);
  cone.userData.isCone = true;
  cone.userData.slotId = slotId;
  floorGroups[obj.pos.floor].add(cone);
  obj.coneMesh = cone;
}

function removeMaintenanceCone(slotId) {
  const obj = slotObjects[slotId];
  if(obj?.coneMesh) {
    floorGroups[obj.pos.floor].remove(obj.coneMesh);
    obj.coneMesh = null;
  }
}

// ── SLOT UPDATE (real-time) ───────────────────
function updateSlot(newData, oldStatus) {
  const id = newData.id;
  const obj = slotObjects[id];
  if(!obj) return;
  
  const isLight = document.body.classList.contains('light-mode');
  const colors = isLight ? {
    available: {floor:0xe8f5e9, border:0x00e676},
    occupied:  {floor:0xffebeb, border:0xff4444},
    reserved:  {floor:0xfff8e1, border:0xffaa00},
    maintenance:{floor:0xf1f5f9, border:0x64748b}
  } : {
    available: {floor:0x1a3a2a, border:0x00e676},
    occupied:  {floor:0x3a1a1a, border:0xff4444},
    reserved:  {floor:0x3a2a0a, border:0xffaa00},
    maintenance:{floor:0x1a1a2a, border:0x475569}
  };
  const c = colors[newData.status] || colors.available;
  
  obj.floorMesh.material.color.setHex(c.floor);
  obj.floorMesh.material.emissive.setHex(c.border);
  obj.borderMeshes.forEach(m => m.material.color.setHex(c.border));
  if (selectedSlotId === id) {
    obj.borderMeshes.forEach(m => m.material.color.setHex(0xffffff));
  }
  
  if(newData.status === 'occupied' && oldStatus !== 'occupied') {
    const vehicle = buildVehicle(newData, obj.pos);
    scene.add(vehicle);
    obj.vehicleGroup = vehicle;
    animateVehicleEntry(id);
    pulseSlot(id);
  } else if(newData.status !== 'occupied' && oldStatus === 'occupied') {
    if(obj.vehicleGroup) {
      animateVehicleExit(id, () => {
        scene.remove(obj.vehicleGroup);
        obj.vehicleGroup = null;
      });
    }
  }
  
  if(newData.status === 'maintenance' && oldStatus !== 'maintenance') addMaintenanceCone(id);
  else if(newData.status !== 'maintenance' && oldStatus === 'maintenance') removeMaintenanceCone(id);
  
  obj.data = {...newData};
}

// ── PULSE EFFECT ─────────────────────────────
function pulseSlot(slotId) {
  const obj = slotObjects[slotId];
  if(!obj) return;
  let frame = 0; 
  const total = 90;
  function pulse() {
    frame++;
    const t = frame/total;
    const intensity = Math.sin(t * Math.PI * 3) * 0.8;
    obj.floorMesh.material.emissiveIntensity = Math.max(0.03, intensity);
    if(frame < total) requestAnimationFrame(pulse);
    else obj.floorMesh.material.emissiveIntensity = 0.03;
  }
  pulse();
}

// ── TEXT SPRITE AND COLOR UTIL ────────────────
function makeTextSprite(text, opts={}) {
  const canvas = document.createElement('canvas');
  canvas.width = opts.w || 128; canvas.height = opts.h || 32;
  const ctx = canvas.getContext('2d');
  if(opts.bg) {
    ctx.fillStyle = opts.bg; ctx.roundRect(0,0,canvas.width,canvas.height,4); ctx.fill();
  }
  ctx.fillStyle = opts.color || '#ffffff';
  ctx.font = `bold ${opts.fontSize||22}px "DM Sans", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width/2, canvas.height/2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false});
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4, 1, 1);
  return sprite;
}

function plateToColor(plate) {
  let hash = 0;
  for(let i=0; i<plate.length; i++) hash = plate.charCodeAt(i) + ((hash<<5)-hash);
  const hue = Math.abs(hash) % 360;
  return new THREE.Color().setHSL(hue/360, 0.6, 0.45);
}

function lightenColor(color, amount) {
  const c = color.clone(); c.r+=amount; c.g+=amount; c.b+=amount; return c;
}

// ── RAYCASTER ─────────────────────────────────
function setupRaycaster() {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  
  renderer.domElement.addEventListener('click', e => {
    mouse.x = (e.clientX/window.innerWidth)*2-1;
    mouse.y = -(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = Object.values(slotObjects).map(o => o.floorMesh);
    const hits = raycaster.intersectObjects(meshes);
    if(hits.length > 0) {
      selectSlot(hits[0].object.userData.slotId);
    } else {
      deselectSlot();
    }
  });
  
  renderer.domElement.addEventListener('mousemove', e => {
    mouse.x = (e.clientX/window.innerWidth)*2-1;
    mouse.y = -(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = Object.values(slotObjects).map(o => o.floorMesh);
    const hits = raycaster.intersectObjects(meshes);
    renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
    
    // Fast hover effect
    Object.values(slotObjects).forEach(o => {
      // Don't reset scale if it's currently pulsing/animated though
      o.floorMesh.scale.set(1,1,1);
    });
    if(hits.length > 0) hits[0].object.scale.set(1.05, 1, 1.05);
  });
}

// ── SELECT SLOT ───────────────────────────────
function selectSlot(slotId) {
  if(selectedSlotId) deselectSlot();
  selectedSlotId = slotId;
  const obj = slotObjects[slotId];
  obj.borderMeshes.forEach(m => m.material.color.set(0xffffff));
  flyToSlot(slotId);
  showSlotInfoPanel(obj.data);
}

function deselectSlot() {
  if(!selectedSlotId) return;
  const obj = slotObjects[selectedSlotId];
  const colors = {available:0x00e676,occupied:0xff4444,reserved:0xffaa00,maintenance:0x64748b};
  const c = colors[obj.data.status] || colors.available;
  obj.borderMeshes.forEach(m => m.material.color.setHex(c));
  selectedSlotId = null;
  document.getElementById('slot-info-panel').classList.add('hidden');
}

// ── FLY TO POS ────────────────────────────────
function flyToSlot(slotId) {
  const obj = slotObjects[slotId];
  cameraTargetPos = new THREE.Vector3(obj.pos.x, obj.pos.y+20, obj.pos.z+30);
  cameraTargetLookAt = new THREE.Vector3(obj.pos.x, obj.pos.y, obj.pos.z);
  isAnimatingCamera = true;
}

function flyToPosition(pos, lookAt) {
  cameraTargetPos = pos.clone();
  cameraTargetLookAt = lookAt.clone();
  isAnimatingCamera = true;
}

// ── SLOT INFO PANEL ───────────────────────────
function showSlotInfoPanel(slot) {
  const panel = document.getElementById('slot-info-panel');
  const content = document.getElementById('slot-info-content');
  const actions = document.getElementById('slot-info-actions');
  
  const statusBadge = {
    available:'<span style="color:#00e676">● Available</span>',
    occupied:'<span style="color:#ff4444">● Occupied</span>',
    reserved:'<span style="color:#ffaa00">● Reserved</span>',
    maintenance:'<span style="color:#94a3b8">● Maintenance</span>'
  };
  
  let html = `
    <div style="font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:700;color:var(--cyan)">${slot.id}</div>
    <div class="info-label">Location</div>
    <div class="info-value">Zone ${slot.zone} &nbsp;·&nbsp; Floor ${slot.floor}</div>
    <div class="info-label">Type</div>
    <div class="info-value uppercase">${slot.type}</div>
    <div class="info-label">Status</div>
    <div>${statusBadge[slot.status]||slot.status}</div>
  `;
  
  if(slot.status==='occupied') {
    html += `
      <div class="info-label">Vehicle</div>
      <div class="info-value text-[var(--cyan)] text-xl tracking-wider uppercase">${slot.plate||'—'}</div>
      <div class="info-label">Owner</div>
      <div class="info-value">${slot.owner||'—'}</div>
      <div class="info-label">Entry Time</div>
      <div class="info-value">${slot.entry_time ? new Date(slot.entry_time).toLocaleTimeString() : '—'}</div>
    `;
  } else if(slot.status==='reserved') {
    html += `
      <div class="info-label">Reserved by</div>
      <div class="info-value">${slot.reserved_by||'—'}</div>
      <div class="info-label">Until</div>
      <div class="info-value">${slot.reserved_until ? new Date(slot.reserved_until).toLocaleString() : '—'}</div>
    `;
  } else if(slot.status==='maintenance') {
    html += `
      <div class="info-label">Reason</div>
      <div class="info-value">${slot.maintenance_reason||'—'}</div>
    `;
  }
  
  content.innerHTML = html;
  
  let btns = `<button class="btn-link-app" onclick="window.open('/','_blank')">Open Dashboard</button>`;
  if(slot.status==='available') {
    btns = `<button class="btn-checkin-3d" onclick="window.open('/?slot=${slot.id}#checkin','_blank')">Check In</button>` + btns;
  } else if(slot.status==='occupied') {
    btns = `<button class="btn-checkout-3d" onclick="window.open('/?slot=${slot.id}#checkout','_blank')">Check Out</button>` + btns;
  }
  actions.innerHTML = btns;
  panel.classList.remove('hidden');
}

// ── ISOLATE FLOOR ─────────────────────────────
function isolateFloor(floor) {
  currentFloorFilter = floor;
  for(let f=1; f<=3; f++) {
    const isVisible = floor==='all' || f===parseInt(floor);
    floorGroups[f].traverse(obj => {
      if(obj.isMesh || obj.isSprite || obj.isGroup) {
        if(obj.material) {
          obj.material.transparent = !isVisible;
          // Animate opacity would be nice but simply setting it works fast
          obj.material.opacity = isVisible ? 1.0 : 0.04;
        }
      }
    });
  }
  document.querySelectorAll('.floor-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.floor === String(floor));
  });
  
  // Also fly camera to view that floor
  if(floor !== 'all') {
    const fy = (parseInt(floor)-1)*18;
    flyToPosition(new THREE.Vector3(0, fy+80, 100), new THREE.Vector3(0, fy, 0));
  } else {
    flyToPosition(new THREE.Vector3(0, 120, 160), new THREE.Vector3(0, 0, 0));
  }
}

// ── SEARCH ────────────────────────────────────
function searchSlot(query) {
  const id = query.toUpperCase().trim();
  const obj = slotObjects[id];
  if(obj) {
    selectSlot(id);
    isolateFloor(obj.pos.floor);
    pulseSlot(id);
    showToast3d(`Found: ${id}`, 'success');
  } else {
    showToast3d(`Slot "${query}" not found`, 'error');
  }
}

// ── HTML UI STATS ─────────────────────────────
function updateStatsOverlay(slots) {
  const counts = {available:0, occupied:0, reserved:0, maintenance:0};
  slots.forEach(s => counts[s.status] = (counts[s.status]||0)+1);
  document.getElementById('stat-available').textContent = counts.available||0;
  document.getElementById('stat-occupied').textContent = counts.occupied||0;
  document.getElementById('stat-reserved').textContent = counts.reserved||0;
  document.getElementById('stat-maintenance').textContent = counts.maintenance||0;
  const now = new Date();
  document.getElementById('last-sync').textContent = `Last sync: ${now.toLocaleTimeString()}`;
}

// ── POLLING ───────────────────────────────────
async function fetchSlots() {
  const res = await fetch(API+'/slots/realtime');
  return await res.json();
}

function startPolling() {
  setInterval(async () => {
    try {
      const slots = await fetchSlots();
      slots.forEach(slot => {
        const oldStatus = previousSlotData[slot.id];
        if(oldStatus && oldStatus !== slot.status) {
          updateSlot(slot, oldStatus);
        }
        previousSlotData[slot.id] = slot.status;
      });
      updateStatsOverlay(slots);
    } catch(e) {
      console.error('Poll error:', e);
    }
  }, 5000);
}

// ── PARTICLES ────────────────────────────────
function setupParticles() {
  const geo = new THREE.BufferGeometry();
  const count = 50;
  const positions = new Float32Array(count*3);
  for(let i=0; i<count*3; i+=3) {
    positions[i]   = (Math.random()-0.5)*200;
    positions[i+1] = Math.random()*60;
    positions[i+2] = (Math.random()-0.5)*120;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const mat = new THREE.PointsMaterial({color:0x334466,size:0.5,transparent:true,opacity:0.4});
  particleSystem = new THREE.Points(geo, mat);
  scene.add(particleSystem);
}

function animateParticles() {
  const pos = particleSystem.geometry.attributes.position.array;
  for(let i=1; i<pos.length; i+=3) {
    pos[i] += 0.03;
    if(pos[i] > 60) pos[i] = 0;
  }
  particleSystem.geometry.attributes.position.needsUpdate = true;
}

function rotateCones() {
  Object.values(slotObjects).forEach(obj => {
    if(obj.coneMesh) obj.coneMesh.rotation.y += 0.02;
  });
}

// ── ANIMATION LOOP ────────────────────────────
function animate() {
  animationFrameId = requestAnimationFrame(animate);
  
  if(isAnimatingCamera && cameraTargetPos) {
    camera.position.lerp(cameraTargetPos, 0.05);
    controls.target.lerp(cameraTargetLookAt, 0.05);
    if(camera.position.distanceTo(cameraTargetPos) < 0.5) {
      isAnimatingCamera = false;
    }
  }
  
  animateParticles();
  rotateCones();
  controls.update();
  renderer.render(scene, camera);
}

// ── EVENTS / KEYBOARD / TOAST MGR ──────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if(document.activeElement.tagName === 'INPUT') return;
    switch(e.key) {
      case 'r': case 'R': flyToPosition(new THREE.Vector3(0,120,160), new THREE.Vector3(0,0,0)); break;
      case ' ': 
        e.preventDefault(); 
        controls.autoRotate = !controls.autoRotate;
        showToast3d(controls.autoRotate ? 'Auto-rotate ON' : 'Auto-rotate OFF', 'info');
        break;
      case '1': isolateFloor('1'); break;
      case '2': isolateFloor('2'); break;
      case '3': isolateFloor('3'); break;
      case '0': isolateFloor('all'); break;
      case 'Escape': deselectSlot(); break;
    }
  });
}

function setupUI() {
  document.getElementById('btn-back').addEventListener('click', () => window.location.href = '/');
  document.querySelectorAll('.floor-tab').forEach(btn => {
    btn.addEventListener('click', () => isolateFloor(btn.dataset.floor));
  });
  document.getElementById('slot-search').addEventListener('keydown', e => {
    if(e.key==='Enter') searchSlot(e.target.value);
  });
  document.getElementById('close-slot-info').addEventListener('click', deselectSlot);
}

function showToast3d(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast-3d ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container-3d').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function getSharedGeometry(key, factory) {
  if(!sharedGeometries[key]) sharedGeometries[key] = factory();
  return sharedGeometries[key];
}

function getSharedMaterial(key, factory) {
  if(!sharedMaterials[key]) sharedMaterials[key] = factory();
  return sharedMaterials[key];
}

// ── BOOTSTRAP ─────────────────────────────────
scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0e1a, 200, 600);
init();
