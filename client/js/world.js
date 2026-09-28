// three.js 场景：竞技场、符文柱、祭坛、其他玩家
import * as THREE from 'three';
import { RUNES, PILLAR_COLLIDE, ALTAR_COLLIDE, pillarPos } from './shared.js';

const ARENA_VIS = 10.4; // 视觉半径（活动半径 9.0）

function glyphTexture(glyph, color, size = 160) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.font = `bold ${size * 0.62}px serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = size * 0.22;
  g.fillStyle = color;
  g.fillText(glyph, size / 2, size / 2 + size * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#070b14';
  g.fillRect(0, 0, s, s);
  const cx = s / 2;
  g.strokeStyle = 'rgba(34,211,238,0.28)';
  for (let r = 60; r < s / 2; r += 68) {
    g.lineWidth = r % 136 === 60 ? 3 : 1;
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(34,211,238,0.16)';
  g.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 70, cx + Math.sin(a) * 70);
    g.lineTo(cx + Math.cos(a) * (s / 2), cx + Math.sin(a) * (s / 2));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTexture(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#000'; g.shadowBlur = 8;
  g.fillStyle = '#e2f0ff';
  g.fillText(name, 128, 34, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060c);
    this.scene.fog = new THREE.Fog(0x04060c, 14, 30);

    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.7, 5);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.4;
    this.players = new Map();
    this.pillars = [];
    this.time = 0;

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.#build();
  }

  #build() {
    const { scene } = this;

    scene.add(new THREE.HemisphereLight(0x88bbff, 0x0a0f1c, 0.55));
    const key = new THREE.DirectionalLight(0xbfd8ff, 0.7);
    key.position.set(6, 12, 4);
    scene.add(key);

    // 地面
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_VIS, 72),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, metalness: 0.25 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // 外墙
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_VIS, ARENA_VIS, 6, 72, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0b1322, roughness: 0.9, metalness: 0.3, side: THREE.BackSide,
      })
    );
    wall.position.y = 3;
    scene.add(wall);

    // 墙顶 / 地面发光环
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide });
    for (const [y, r, ir] of [[0.03, ARENA_VIS, ARENA_VIS - 0.12], [5.6, ARENA_VIS, ARENA_VIS - 0.12]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(ir, r, 72), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = y;
      scene.add(ring);
    }

    // 符文柱
    RUNES.forEach((rune, idx) => {
      const { x, z } = pillarPos(idx);
      const group = new THREE.Group();
      group.position.set(x, 0, z);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.95, 1.1, 6),
        new THREE.MeshStandardMaterial({ color: 0x141c2e, roughness: 0.6, metalness: 0.55 })
      );
      base.position.y = 0.55;
      group.add(base);

      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.4, 1.5, 6),
        new THREE.MeshStandardMaterial({
          color: 0x0d1526, roughness: 0.4, metalness: 0.6,
          emissive: new THREE.Color(rune.color), emissiveIntensity: 0.18,
        })
      );
      core.position.y = 1.85;
      group.add(core);

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glyphTexture(rune.glyph, rune.color),
        transparent: true, depthWrite: false,
      }));
      sprite.scale.set(1.35, 1.35, 1);
      sprite.position.y = 3.3;
      group.add(sprite);

      const light = new THREE.PointLight(rune.color, 6, 7, 2);
      light.position.y = 3.3;
      group.add(light);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.25, 32),
        new THREE.MeshBasicMaterial({ color: rune.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.04;
      group.add(halo);

      // 交互与动画标记
      for (const m of [base, core]) m.userData = { kind: 'rune', idx };
      sprite.userData = { kind: 'rune', idx };
      this.pillars.push({ group, sprite, light, halo, idx, pulse: 0, baseY: 3.3 });

      scene.add(group);
    });

    // 中央祭坛
    const altar = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.6, 0.35, 32),
      new THREE.MeshStandardMaterial({ color: 0x101a30, roughness: 0.35, metalness: 0.7 })
    );
    slab.position.y = 0.18;
    slab.userData = { kind: 'altar' };
    altar.add(slab);

    this.altarRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.2, 48),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.altarRing.rotation.x = -Math.PI / 2;
    this.altarRing.position.y = 0.37;
    altar.add(this.altarRing);

    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glyphTexture('◎', '#22d3ee'), transparent: true, depthWrite: false, opacity: 0.9,
    }));
    beacon.scale.set(1.6, 1.6, 1);
    beacon.position.y = 2.4;
    beacon.userData = { kind: 'altar' };
    altar.add(beacon);
    this.altarBeacon = beacon;

    scene.add(altar);
  }

  // ===== 其他玩家 =====
  addPlayer(id, name, color) {
    if (this.players.has(id)) return;
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.85, 6, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(color), emissiveIntensity: 0.22 })
    );
    body.position.y = 0.95;
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.35, -0.34);
    group.add(nose);

    const tag = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameTexture(name), transparent: true, depthWrite: false,
    }));
    tag.scale.set(1.8, 0.45, 1);
    tag.position.y = 2.15;
    group.add(tag);

    group.position.set(0, 0, 0);
    this.scene.add(group);
    this.players.set(id, {
      group,
      target: { x: 0, z: 0, yaw: 0 },
      cur: { x: 0, z: 0, yaw: 0 },
      init: false,
    });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.players.delete(id);
  }

  clearPlayers() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
  }

  applySnapshot(list) {
    for (const s of list) {
      const p = this.players.get(s.id);
      if (!p) continue;
      p.target.x = s.x; p.target.z = s.z; p.target.yaw = s.yaw;
      if (!p.init) {
        p.cur.x = s.x; p.cur.z = s.z; p.cur.yaw = s.yaw;
        p.init = true;
      }
    }
  }

  pulseRune(idx) {
    const p = this.pillars[idx];
    if (p) p.pulse = 1;
  }

  // 视线交互检测
  pick() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud && ud.kind) return ud;
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;

    for (const p of this.pillars) {
      p.sprite.position.y = p.baseY + Math.sin(t * 1.6 + p.idx) * 0.12;
      p.sprite.material.rotation = Math.sin(t * 0.6 + p.idx) * 0.15;
      if (p.pulse > 0) {
        p.pulse = Math.max(0, p.pulse - dt * 1.6);
        const k = p.pulse;
        p.sprite.scale.setScalar(1.35 + k * 0.9);
        p.light.intensity = 6 + k * 26;
      } else {
        p.sprite.scale.setScalar(1.35);
        p.light.intensity = 6;
      }
      p.halo.material.opacity = 0.3 + Math.sin(t * 2 + p.idx) * 0.12;
    }

    this.altarRing.rotation.z = t * 0.5;
    this.altarRing.material.opacity = 0.4 + Math.sin(t * 2.2) * 0.15;
    this.altarBeacon.material.rotation = t * 0.8;

    for (const p of this.players.values()) {
      const k = Math.min(1, dt * 10);
      p.cur.x += (p.target.x - p.cur.x) * k;
      p.cur.z += (p.target.z - p.cur.z) * k;
      let dy = p.target.yaw - p.cur.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.cur.yaw += dy * k;
      p.group.position.set(p.cur.x, 0, p.cur.z);
      p.group.rotation.y = p.cur.yaw;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
