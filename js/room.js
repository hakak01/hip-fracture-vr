// Operating room: floor, walls, lights, fracture table and fixed furniture.
import * as THREE from 'three';

export const TABLE_TOP = 0.92; // metres above floor

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9fb0ae'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${120 + Math.random() * 40},${135 + Math.random() * 40},${130 + Math.random() * 40},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  g.strokeStyle = '#7d8d8b'; g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  t.anisotropy = 4;
  return t;
}

export function buildRoom(scene) {
  const room = new THREE.Group();
  room.name = 'room';

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9dbd6, roughness: 0.95, side: THREE.BackSide, emissive: 0x3a4846 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(10, 3.2, 10), wallMat);
  walls.position.y = 1.6;
  room.add(walls);

  // ceiling operating light
  const lamp = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  arm.position.y = 0.3;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.33, 32), new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
  glow.rotation.x = Math.PI / 2; glow.position.y = -0.061;
  lamp.add(arm, head, glow);
  lamp.position.set(-0.3, 2.55, -0.25);
  room.add(lamp);

  scene.add(new THREE.HemisphereLight(0xf4fbff, 0x5d6b6a, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(-1.2, 3.0, 0.8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfeeff, 0.7);
  fill.position.set(2, 2, -2);
  scene.add(fill);

  // fracture table (radiolucent top for the torso and pelvis)
  const padMat = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4aa, roughness: 0.35, metalness: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 1.75), padMat);
  top.position.set(0, TABLE_TOP - 0.035, -0.8);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.28, TABLE_TOP - 0.15, 0.36), steel);
  column.position.set(0, (TABLE_TOP - 0.15) / 2 + 0.08, -1.05);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 1.1), steel);
  base.position.set(0, 0.04, -1.1);
  // padded perineal post (z is set from the CT anatomy in main.js)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 20),
    new THREE.MeshStandardMaterial({ color: 0x3b4348, roughness: 0.6 }));
  post.position.set(0, TABLE_TOP + 0.02, 0.1);
  post.name = 'perineal-post';
  room.add(top, column, base, post);
  room.userData.post = post;

  scene.add(room);
  return room;
}

// Side-dependent furniture (leg spar, well-leg holder). Mirrored with the side choice.
export function buildSideFurniture() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4aa, roughness: 0.35, metalness: 0.6 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.7 });
  // spar under the operated leg (patient right = -x)
  const spar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 1.0), steel);
  spar.position.set(-0.11, TABLE_TOP - 0.17, 0.62);
  const sparLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, TABLE_TOP - 0.19), steel);
  sparLeg.position.set(-0.11, (TABLE_TOP - 0.19) / 2, 1.08);
  const sparFoot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), steel);
  sparFoot.position.set(-0.11, 0.015, 1.08);
  // well-leg holder under the lowered contralateral calf
  const holderPost = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5), steel);
  holderPost.position.set(0.1, 0.25, 0.86);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.3), pad);
  cradle.position.set(0.1, 0.52, 0.86);
  const holderFoot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), steel);
  holderFoot.position.set(0.1, 0.015, 0.86);
  g.add(spar, sparLeg, sparFoot, holderPost, cradle, holderFoot);
  g.userData.cradle = cradle;
  return g;
}
