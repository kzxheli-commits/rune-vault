// 第一人称控制：指针锁定、WASD、碰撞、视线交互
import * as THREE from 'three';
import {
  ARENA_RADIUS, PILLAR_COLLIDE, ALTAR_COLLIDE, PILLAR_RING, pillarPos,
} from './shared.js';

const WALK = 3.6;
const RUN = 5.8;
const PLAYER_R = 0.35;

export class Controls {
  constructor(camera, canvas, onInteract) {
    this.camera = camera;
    this.canvas = canvas;
    this.onInteract = onInteract;
    this.enabled = false;
    this.locked = false;
    this.pos = { x: 0, z: 5.5 };
    this.yaw = 0; // 面向场地中心（-z）
    this.pitch = 0;
    this.keys = new Set();
    this.bob = 0;
    this.moving = false;

    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked) {
        try {
          const r = canvas.requestPointerLock();
          if (r && r.catch) r.catch(() => {});
        } catch { /* 忽略 */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch -= e.movementY * 0.0023;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return; // 聊天输入时不移动
      if (e.code === 'KeyE' && this.locked && this.enabled && !e.repeat) {
        this.onInteract && this.onInteract();
      }
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v && document.pointerLockElement) document.exitPointerLock();
    if (v) {
      this.pos.x = 0; this.pos.z = 5.5;
      this.yaw = 0; this.pitch = 0;
    }
  }

  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  update(dt) {
    let mx = 0, mz = 0;
    if (this.enabled && this.locked) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? RUN : WALK;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // 相机空间 -> 世界空间 (Ry(yaw) * local)
      const wx = (mx * cos + mz * sin);
      const wz = (-mx * sin + mz * cos);
      this.pos.x += wx * speed * dt;
      this.pos.z += wz * speed * dt;
      this.bob += dt * speed * 1.8;
    }

    this.#collide();

    const eyeY = 1.68 + (this.moving ? Math.sin(this.bob) * 0.045 : 0);
    this.camera.position.set(this.pos.x, eyeY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  #collide() {
    // 竞技场边界
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = ARENA_RADIUS;
    if (r > maxR) {
      this.pos.x = (this.pos.x / r) * maxR;
      this.pos.z = (this.pos.z / r) * maxR;
    }
    // 符文柱
    const resolve = (cx, cz, rad) => {
      const dx = this.pos.x - cx, dz = this.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < rad && d > 0.0001) {
        this.pos.x = cx + (dx / d) * rad;
        this.pos.z = cz + (dz / d) * rad;
      }
    };
    for (let i = 0; i < 6; i++) {
      const p = pillarPos(i);
      resolve(p.x, p.z, PILLAR_COLLIDE + PLAYER_R);
    }
    resolve(0, 0, ALTAR_COLLIDE + PLAYER_R);
  }

  // 视线内可交互对象：优先射线，退化为距离+朝向判定
  pick() {
    if (!this.enabled) return null;
    const fx = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
    const near = (tx, tz, maxDist, maxAngle) => {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist || d < 0.001) return false;
      const dot = (dx / d) * fx + (dz / d) * fz;
      return dot > Math.cos(maxAngle);
    };

    // 中央祭坛
    if (near(0, 0, 3.1, Math.PI / 2.4)) return { kind: 'altar' };
    // 符文柱
    let best = null, bestD = 1e9;
    for (let i = 0; i < 6; i++) {
      const p = pillarPos(i);
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < 3.0 && d < bestD && near(p.x, p.z, 3.0, Math.PI / 3)) {
        best = { kind: 'rune', idx: i };
        bestD = d;
      }
    }
    return best;
  }
}
