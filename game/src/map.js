// map.js — the Meridian Roof: one original rooftop map built from styled
// geometry. Exports the colliders (AABBs), raycast occluders, capture zones,
// spawn points and the waypoint graph the bots navigate.
import * as THREE from 'three';
import { CFG, ZONES } from './state.js';
import { signTexture } from './textures.js';

function aabb(x, z, w, d, h) {
  return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: 0, y1: h };
}

// 2D segment vs AABB test used to auto-link the waypoint graph.
function segHitsBox(x0, z0, x1, z1, b, pad) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minZ = Math.min(z0, z1), maxZ = Math.max(z0, z1);
  if (maxX < b.x0 - pad || minX > b.x1 + pad || maxZ < b.z0 - pad || minZ > b.z1 + pad) return false;
  // sample along the segment; cheap and robust for short waypoint links
  const dx = x1 - x0, dz = z1 - z0;
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t, z = z0 + dz * t;
    if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
  }
  return false;
}

export function buildWorld(scene, tex) {
  const world = {
    scene,
    colliders: [],
    occluders: [],
    shotMeshes: [],
    zones: [],
    spawns: { az: [], cr: [] },
    waypoints: [],
    beacons: [],
  };
  const W = CFG.MAP_W, D = CFG.MAP_D;

  const matRoof = new THREE.MeshStandardMaterial({ map: tex.roof, roughness: 0.55, metalness: 0.25 });
  const matMetal = new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.5, metalness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.7, metalness: 0.4 });
  const matWall = new THREE.MeshStandardMaterial({ color: 0x39415a, roughness: 0.6, metalness: 0.3 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.85, metalness: 0.05 });
  const matCrate2 = new THREE.MeshStandardMaterial({ color: 0x2e4a3a, roughness: 0.85, metalness: 0.05 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x2a6a8a, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1 });
  const matHazard = new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.7, metalness: 0.1 });
  const matPlant = new THREE.MeshStandardMaterial({ color: 0x2d5a34, roughness: 0.9 });
  const matPlant2 = new THREE.MeshStandardMaterial({ color: 0x3f7a44, roughness: 0.9 });

  function box(x, z, w, h, d, mat, collide, occlude, y) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, (y === undefined ? h / 2 : y), z);
    scene.add(m);
    if (collide !== false) world.colliders.push(aabb(x, z, w, d, h));
    if (occlude !== false) world.occluders.push(m);
    return m;
  }

  // ---- floor slab and parapet ring ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W + 2, 1, D + 2), matRoof);
  floor.position.set(0, -0.5, 0);
  scene.add(floor);
  world.shotMeshes.push(floor);
  const pt = 0.6, ph = CFG.WALL_H;
  const edges = [
    [0, -D / 2 - pt / 2, W + 2, pt], [0, D / 2 + pt / 2, W + 2, pt],
    [-W / 2 - pt / 2, 0, pt, D + 2], [W / 2 + pt / 2, 0, pt, D + 2],
  ];
  for (const [x, z, w, d] of edges) {
    const m = box(x, z, w, ph, d, matWall, true, true);
    m.position.y = ph / 2;
    // neon coping strip along the parapet top
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w === pt ? 0.14 : w, 0.07, d === pt ? 0.14 : d),
      new THREE.MeshStandardMaterial({ color: 0x37e6ff, emissive: 0x37e6ff, emissiveIntensity: 1.6 }));
    strip.position.set(x, ph + 0.035, z);
    scene.add(strip);
  }

  // ---- central atrium: glass skylight block, the map's anchor ----
  box(0, 0, 10, 2.3, 6, matMetal, true, true);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.5, 4.6), matGlass);
  glass.position.set(0, 2.55, 0);
  scene.add(glass);
  box(-5.6, 0, 0.8, 2.3, 6, matDark, true, true);
  box(5.6, 0, 0.8, 2.3, 6, matDark, true, true);
  // hazard kick plates on the atrium faces
  for (const z of [-3.05, 3.05]) {
    const kick = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 0.1), matHazard);
    kick.position.set(0, 0.25, z);
    scene.add(kick);
  }

  // ---- stair bulkheads with doors and rooftop signs ----
  function bulkhead(x, z, w, d, signText, signColor) {
    box(x, z, w, 3.2, d, matWall, true, true);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.25, d + 0.5), matDark);
    roof.position.set(x, 3.32, z);
    scene.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.6, metalness: 0.5 }));
    door.position.set(x, 1.1, z + d / 2 + 0.03);
    scene.add(door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshBasicMaterial({ map: signTextureLocal(signText, signColor) }));
    sign.position.set(x, 2.6, z + d / 2 + 0.06);
    scene.add(sign);
  }
  // sign textures are cached so identical signs share one canvas texture
  const signCache = {};
  function signTextureLocal(text, color) {
    if (!signCache[text]) signCache[text] = signTexture(text, color);
    return signCache[text];
  }
  bulkhead(-14, 10, 6, 4, 'MERIDIAN', '#37e6ff');
  bulkhead(8, -12, 5, 4, 'ROOF 42', '#ff3d7e');

  // ---- helipad: painted circle, drums, windsock pole ----
  const pad = new THREE.Mesh(new THREE.CircleGeometry(7.2, 40),
    new THREE.MeshStandardMaterial({ map: tex.pad, roughness: 0.6, metalness: 0.2 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(-22, 0.02, -8);
  scene.add(pad);
  world.shotMeshes.push(pad);
  for (const [dx, dz, col] of [[-3.4, 4.6, 0x8a2f2f], [-2.2, 5.2, 0x2f6a8a]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 14),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.6 }));
    drum.position.set(-22 + dx, 0.65, -8 + dz);
    scene.add(drum);
    world.colliders.push(aabb(-22 + dx, -8 + dz, 1.1, 1.1, 1.3));
    world.occluders.push(drum);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 8), matMetal);
  pole.position.set(-27, 2.1, -13);
  scene.add(pole);
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.3, 10),
    new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0x903a00, emissiveIntensity: 0.5 }));
  sock.rotation.z = Math.PI / 2.4;
  sock.position.set(-26.6, 4.1, -13);
  scene.add(sock);

  // ---- antenna mast with blinking beacon ----
  const mastBase = box(-4, -19.5, 2.2, 1.0, 2.2, matDark, true, true);
  mastBase.position.y = 0.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 11, 8), matMetal);
  mast.position.set(-4, 6.5, -19.5);
  scene.add(mast);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4 - i * 0.5, 0.12, 0.12), matMetal);
    bar.position.set(-4, 4 + i * 2.6, -19.5);
    scene.add(bar);
  }
  const beaconMat = new THREE.SpriteMaterial({ map: tex.glow, color: 0xff2a3d, transparent: true, depthWrite: false });
  const beacon = new THREE.Sprite(beaconMat);
  beacon.scale.set(1.6, 1.6, 1);
  beacon.position.set(-4, 12.2, -19.5);
  scene.add(beacon);
  world.beacons.push(beaconMat);

  // ---- AC farm (north-east) ----
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const x = 19 + i * 3.1, z = -15 + j * 2.6;
    box(x, z, 2.6, 1.35, 2.0, matMetal, true, true);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 18), matDark);
    fan.position.set(x, 1.42, z);
    scene.add(fan);
  }
  // vent pipes along the south parapet
  for (let i = 0; i < 4; i++) {
    const x = -18 + i * 11;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.6, 12), matMetal);
    pipe.position.set(x, 1.3, 21.6);
    scene.add(pipe);
    world.colliders.push(aabb(x, 21.6, 0.9, 0.9, 2.6));
    world.occluders.push(pipe);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12), matDark);
    cap.position.set(x, 2.7, 21.6);
    scene.add(cap);
  }

  // ---- crates: the lane cover kit ----
  const crateSpots = [
    [-10, -6, 1.5, 0], [-10, -4.4, 1.1, 1], [6, 4, 1.5, 1], [7.6, 4.2, 1.1, 0],
    [-18, 4, 1.4, 1], [18, -4, 1.4, 0], [12, 14, 1.5, 0], [-6, 14, 1.4, 1],
    [24, 8, 1.3, 1], [-26, -1, 1.3, 0], [2, -8, 1.2, 0], [-2, 8, 1.2, 1],
    [26, -12, 1.4, 0], [-14, -14, 1.4, 1], [10, -18, 1.3, 1], [20, 18, 1.2, 0],
  ];
  for (const [x, z, s, alt] of crateSpots) {
    box(x, z, s, s, s, alt ? matCrate2 : matCrate, true, true);
  }
  // stacked pair near the garden for a high corner
  box(9, 9, 1.5, 1.5, 1.5, matCrate, true, true);
  const top = box(9, 9, 1.1, 1.1, 1.1, matCrate2, false, true, 2.05);
  top.position.y = 2.05;

  // ---- garden planters with shrubs ----
  for (const [x, z] of [[12, 1], [17, 1], [12, 11], [17, 11]]) {
    box(x, z, 3.2, 0.9, 1.2, matDark, true, true);
    for (let i = 0; i < 3; i++) {
      const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0),
        i % 2 ? matPlant : matPlant2);
      shrub.position.set(x - 1 + i, 1.25, z);
      shrub.scale.y = 0.8;
      scene.add(shrub);
    }
  }
  // low garden bench + lamp posts
  box(14.5, 3.4, 2.2, 0.55, 0.6, matCrate2, true, true);
  for (const [x, z, col] of [[11, 6, 0x37e6ff], [18, 6, 0xff3d7e], [-22, -1, 0x37e6ff]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 8), matDark);
    post.position.set(x, 1.3, z);
    scene.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.2 }));
    lamp.position.set(x, 2.7, z);
    scene.add(lamp);
  }

  // ---- capture zones: ring, disc and light beam ----
  for (const def of ZONES) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(def.r, 0.14, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(def.x, 0.12, def.z);
    scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(def.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(def.x, 0.06, def.z);
    scene.add(disc);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(def.r * 0.55, def.r * 0.8, 16, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(def.x, 8, def.z);
    scene.add(beam);
    world.zones.push({ ...def, ring, disc, beam });
  }

  // ---- skyline: instanced towers with lit windows, distant signs, city floor ----
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  const towerMat = new THREE.MeshStandardMaterial({ map: tex.windows, emissive: 0xffffff, emissiveMap: tex.windows, emissiveIntensity: 0.85, roughness: 0.9 });
  const towers = new THREE.InstancedMesh(towerGeo, towerMat, 120);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  let ti = 0;
  for (let ring = 0; ring < 2 && ti < 120; ring++) {
    const radius = ring === 0 ? 95 : 135;
    const count = ring === 0 ? 52 : 68;
    for (let i = 0; i < count && ti < 120; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.11;
      const r = radius + (Math.random() - 0.5) * 22;
      const w = 12 + Math.random() * 16, h = 24 + Math.random() * 58, d = 12 + Math.random() * 16;
      pos.set(Math.cos(a) * r, h / 2 - 38, Math.sin(a) * r);
      scl.set(w, h, d);
      m4.compose(pos, q, scl);
      towers.setMatrixAt(ti++, m4);
    }
  }
  towers.count = ti;
  scene.add(towers);
  const cityFloor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500),
    new THREE.MeshBasicMaterial({ color: 0x070a12 }));
  cityFloor.rotation.x = -Math.PI / 2;
  cityFloor.position.y = -38;
  scene.add(cityFloor);
  // distant rooftop signs
  const farSigns = [['NOODLE', '#ffb347', 0.4], ['HOTEL', '#37e6ff', 2.2], ['RAMEN', '#ff3d7e', 3.9], ['CLUB X', '#b98aff', 5.3]];
  for (const [text, col, ang] of farSigns) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(16, 4),
      new THREE.MeshBasicMaterial({ map: signTextureLocal(text, col) }));
    s.position.set(Math.cos(ang) * 100, 26, Math.sin(ang) * 100);
    s.lookAt(0, 20, 0);
    scene.add(s);
  }

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0x3a5a8a, 0x0a0c14, 1.15));
  const moon = new THREE.DirectionalLight(0x9fb8e8, 0.95);
  moon.position.set(-30, 50, -20);
  scene.add(moon);
  const points = [
    [-22, 5, -8, 0x37e6ff, 26], [14, 5, 6, 0xff3d7e, 24],
    [0, 5, 0, 0xffd98a, 22], [-4, 6, -17, 0x37e6ff, 20], [20, 5, -14, 0x9fd8ff, 18],
  ];
  for (const [x, y, z, col, dist] of points) {
    const pl = new THREE.PointLight(col, 22, dist, 1.8);
    pl.position.set(x, y, z);
    scene.add(pl);
  }

  // ---- spawns ----
  world.spawns.az = [[26, 16, -2.4], [22, 20, -2.8], [28, 9, -2.2]];
  world.spawns.cr = [[-26, -15, 0.7], [-22, -19, 0.4], [-28, -9, 0.9]];

  // ---- waypoint graph: grid nodes filtered by colliders, auto-linked ----
  const nodes = [];
  for (let x = -28; x <= 28; x += 8) {
    for (let z = -20; z <= 20; z += 8) {
      let inside = false;
      for (const b of world.colliders) {
        if (x > b.x0 - 0.9 && x < b.x1 + 0.9 && z > b.z0 - 0.9 && z < b.z1 + 0.9 && b.y1 > 0.8) { inside = true; break; }
      }
      if (!inside) nodes.push({ x, z, links: [] });
    }
  }
  // explicit nodes: zone centres and spawn aprons, so bots path onto the hill
  for (const def of ZONES) nodes.push({ x: def.x, z: def.z, links: [], zone: def.id });
  for (const s of [...world.spawns.az, ...world.spawns.cr]) nodes.push({ x: s[0], z: s[1], links: [] });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 13.5) continue;
      let blocked = false;
      for (const col of world.colliders) {
        if (col.y1 < 0.8) continue;
        if (segHitsBox(a.x, a.z, b.x, b.z, col, 0.55)) { blocked = true; break; }
      }
      if (!blocked) { a.links.push(j); b.links.push(i); }
    }
  }
  world.waypoints = nodes;
  world.shotMeshes.push(...world.occluders);
  return world;
}

// Tint a zone's ring/disc/beam for its current state. Called by rounds.js.
export function paintZone(zone, color, beamOpacity) {
  zone.ring.material.color.setHex(color);
  zone.disc.material.color.setHex(color);
  zone.beam.material.color.setHex(color);
  zone.beam.material.opacity = beamOpacity;
}

// Nearest waypoint index to a point; used as the path start/goal.
export function nearestWaypoint(waypoints, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = (waypoints[i].x - x) ** 2 + (waypoints[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first path over the waypoint graph. Returns an array of node
// indices from start to goal (inclusive), or [] when unreachable.
export function findPath(waypoints, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const prev = new Int32Array(waypoints.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of waypoints[cur].links) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === toIdx) {
        const path = [nb];
        let p = cur;
        while (p !== fromIdx) { path.push(p); p = prev[p]; }
        path.push(fromIdx);
        path.reverse();
        return path;
      }
      queue.push(nb);
    }
  }
  return [];
}
