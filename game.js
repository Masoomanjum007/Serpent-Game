(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════
  const GRID = 20;
  const CELL = 1;
  const BOARD_HALF = (GRID * CELL) / 2;
  const TICK_START = 180;
  const TICK_MIN = 55;
  const TICK_DECREASE = 22;
  const FOODS_PER_LEVEL = 5;
  const LERP_SPEED = 0.22;
  const SHIMMER_SPEED = 3.5;
  const POOL_SIZE = 120;
  const HS_KEY = 'serpent3d_highscore';

  const DIR = {
    up:    { x: 0, z: -1 },
    down:  { x: 0, z:  1 },
    left:  { x: -1, z: 0 },
    right: { x:  1, z: 0 }
  };

  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

  const COLORS = {
    bg: 0x0a0a12,
    board: 0x0d0d1f,
    grid: 0x1a1a3a,
    border: 0x00f5ff,
    snakeA: 0x00f5ff,
    snakeB: 0x7b2fff,
    food: 0xff2d78,
    foodOrbit: 0xff6ba8,
    particle: 0x00f5ff
  };

  // ═══════════════════════════════════════════════════════════
  // 1. SCENE & RENDERER SETUP
  // ═══════════════════════════════════════════════════════════
  const canvas = document.getElementById('game-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(COLORS.bg, 1);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.bg, 0.04);

  const ORTHO_SIZE = 11.5;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 0, -1);

  const ambientLight = new THREE.AmbientLight(0x6b3fa0, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 15, 8);
  scene.add(dirLight);

  const starsGeo = new THREE.BufferGeometry();
  const starCount = 600;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3]     = (Math.random() - 0.5) * 80;
    starPos[i * 3 + 1] = -5 - Math.random() * 20;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({
    color: 0xaaaaff, size: 0.12, transparent: true, opacity: 0.6
  })));

  // ═══════════════════════════════════════════════════════════
  // 2. BOARD CREATION — flat square, centered
  // ═══════════════════════════════════════════════════════════
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const boardPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID * CELL, GRID * CELL),
    new THREE.MeshStandardMaterial({
      color: COLORS.board,
      transparent: true,
      opacity: 0.15,
      metalness: 0.3,
      roughness: 0.2,
      emissive: 0x0a0a1a,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide
    })
  );
  boardPlane.rotation.x = -Math.PI / 2;
  boardGroup.add(boardPlane);

  const gridVerts = [];
  for (let i = 0; i <= GRID; i++) {
    const o = -BOARD_HALF + i * CELL;
    gridVerts.push(-BOARD_HALF, 0.02, o, BOARD_HALF, 0.02, o);
    gridVerts.push(o, 0.02, -BOARD_HALF, o, 0.02, BOARD_HALF);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
  boardGroup.add(new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.6 })
  ));

  const b = BOARD_HALF + 0.05;
  const borderVerts = [-b, 0.03, -b, b, 0.03, -b, b, 0.03, b, -b, 0.03, b, -b, 0.03, -b];
  const borderGeo = new THREE.BufferGeometry();
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderVerts, 3));
  boardGroup.add(new THREE.Line(
    borderGeo,
    new THREE.LineBasicMaterial({ color: COLORS.border, transparent: true, opacity: 0.7 })
  ));

  function gridToWorld(gx, gz) {
    return {
      x: -BOARD_HALF + gx * CELL + CELL * 0.5,
      y: 0.45,
      z: -BOARD_HALF + gz * CELL + CELL * 0.5
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 5. PARTICLE POOL
  // ═══════════════════════════════════════════════════════════
  const particlePool = [];
  const poolGroup = new THREE.Group();
  scene.add(poolGroup);

  const poolGeo = new THREE.SphereGeometry(0.08, 6, 6);

  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.particle,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(poolGeo, mat);
    mesh.visible = false;
    poolGroup.add(mesh);
    particlePool.push({
      mesh, active: false, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0
    });
  }

  let poolIndex = 0;

  function spawnParticle(x, y, z, color, speed, life, spread) {
    const p = particlePool[poolIndex];
    poolIndex = (poolIndex + 1) % POOL_SIZE;
    p.active = true;
    p.life = life;
    p.maxLife = life;
    p.vx = (Math.random() - 0.5) * spread;
    p.vy = Math.random() * speed * 0.5 + speed * 0.3;
    p.vz = (Math.random() - 0.5) * spread;
    p.mesh.position.set(x, y, z);
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(0.6 + Math.random() * 0.6);
  }

  function spawnBurst(x, y, z, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 0.06 + Math.random() * 0.08;
      const p = particlePool[poolIndex];
      poolIndex = (poolIndex + 1) % POOL_SIZE;
      p.active = true;
      p.life = 0.5 + Math.random() * 0.4;
      p.maxLife = p.life;
      p.vx = Math.cos(angle) * speed;
      p.vy = 0.03 + Math.random() * 0.06;
      p.vz = Math.sin(angle) * speed;
      p.mesh.position.set(x, y, z);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.8 + Math.random() * 0.5);
    }
  }

  function updateParticles(dt) {
    for (const p of particlePool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      const t = p.life / p.maxLife;
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.z += p.vz;
      p.vy -= 0.002;
      p.mesh.material.opacity = t;
      p.mesh.scale.setScalar(0.3 + t * 0.7);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. SNAKE CLASS
  // ═══════════════════════════════════════════════════════════
  class Snake {
    constructor() {
      this.group = new THREE.Group();
      scene.add(this.group);
      this.segments = [];
      this.gridPos = [];
      this.visualPos = [];
      this.direction = 'right';
      this.nextDirection = null;
      this.shimmerPhase = 0;
      this.slitherPhase = 0;
      this.headPulse = 0;
      this.headGroup = null;
      this.eyes = null;
      this.tongue = null;
      this.linkGeo = new THREE.SphereGeometry(1, 12, 10);
      this.scaleTex = this._buildScaleTexture();
      this._lookTarget = new THREE.Vector3();
      this._tempVec = new THREE.Vector3();
      this._tempVec2 = new THREE.Vector3();
      this.reset();
    }

    _buildScaleTexture() {
      const size = 128;
      const cvs = document.createElement('canvas');
      cvs.width = size;
      cvs.height = size;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = '#0a2840';
      ctx.fillRect(0, 0, size, size);
      const rows = 10;
      const cols = 8;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ox = (col / cols) * size + (row % 2) * (size / cols * 0.5);
          const oy = (row / rows) * size;
          const w = size / cols * 0.82;
          const h = size / rows * 0.78;
          const g = ctx.createLinearGradient(ox, oy, ox + w, oy + h);
          g.addColorStop(0, '#00e8ff');
          g.addColorStop(0.5, '#3d9fff');
          g.addColorStop(1, '#9b5cff');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(ox + w * 0.5, oy + h * 0.5, w * 0.46, h * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      const tex = new THREE.CanvasTexture(cvs);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 1);
      return tex;
    }

    _bodyMaterial(i, total) {
      const t = i / Math.max(total - 1, 1);
      const tint = new THREE.Color(COLORS.snakeA).lerp(new THREE.Color(COLORS.snakeB), t);
      return new THREE.MeshStandardMaterial({
        map: this.scaleTex,
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.75 + (1 - t) * 0.35,
        metalness: 0.25,
        roughness: 0.35
      });
    }

    _clearMeshes() {
      for (const s of this.segments) {
        this.group.remove(s.mesh);
        if (s.mesh.geometry && s.mesh.geometry !== this.linkGeo) s.mesh.geometry.dispose();
        s.mat.dispose();
      }
      this.segments = [];
      if (this.headGroup) {
        this.group.remove(this.headGroup);
        this.headGroup.traverse((o) => {
          if (o.geometry && o.geometry !== this.linkGeo) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.headGroup = null;
      }
      this.eyes = null;
      this.tongue = null;
    }

    reset() {
      this._clearMeshes();
      this.gridPos = [];
      this.visualPos = [];
      const startX = Math.floor(GRID / 2);
      const startZ = Math.floor(GRID / 2);
      for (let i = 0; i < 3; i++) {
        this.gridPos.push({ x: startX - i, z: startZ });
      }
      this.direction = 'right';
      this.nextDirection = null;
      this.shimmerPhase = 0;
      this.slitherPhase = 0;
      this.rebuildMeshes();
    }

    _createHead() {
      const headMat = new THREE.MeshStandardMaterial({
        map: this.scaleTex,
        color: 0x88ffff,
        emissive: new THREE.Color(COLORS.snakeA),
        emissiveIntensity: 1.1,
        metalness: 0.3,
        roughness: 0.25
      });
      this.headGroup = new THREE.Group();
      const skull = new THREE.Mesh(this.linkGeo, headMat);
      skull.scale.set(0.46, 0.38, 0.62);
      this.headGroup.add(skull);

      const snout = new THREE.Mesh(this.linkGeo, headMat.clone());
      snout.scale.set(0.32, 0.28, 0.28);
      snout.position.set(0, 0, 0.38);
      this.headGroup.add(snout);

      const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
      const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xf0f4ea });
      const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1a10 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeWhite);
      const eyeR = new THREE.Mesh(eyeGeo, eyeWhite.clone());
      eyeL.position.set(-0.2, 0.1, 0.28);
      eyeR.position.set(0.2, 0.1, 0.28);
      this.headGroup.add(eyeL);
      this.headGroup.add(eyeR);

      const pupilGeo = new THREE.SphereGeometry(0.045, 6, 6);
      const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
      const pupilR = new THREE.Mesh(pupilGeo, pupilMat.clone());
      pupilL.position.set(0, 0, 0.06);
      pupilR.position.set(0, 0, 0.06);
      eyeL.add(pupilL);
      eyeR.add(pupilR);
      this.eyes = { left: eyeL, right: eyeR, pupilL, pupilR };

      const tongueMat = new THREE.MeshBasicMaterial({ color: 0xcc2244 });
      this.tongue = new THREE.Group();
      const tongueBase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.18, 6), tongueMat);
      tongueBase.rotation.x = Math.PI / 2;
      tongueBase.position.z = 0.52;
      const forkL = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.14, 4), tongueMat.clone());
      forkL.rotation.x = Math.PI / 2;
      forkL.rotation.z = 0.35;
      forkL.position.set(-0.04, 0, 0.64);
      const forkR = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.14, 4), tongueMat.clone());
      forkR.rotation.x = Math.PI / 2;
      forkR.rotation.z = -0.35;
      forkR.position.set(0.04, 0, 0.64);
      this.tongue.add(tongueBase);
      this.tongue.add(forkL);
      this.tongue.add(forkR);
      this.headGroup.add(this.tongue);

      this.group.add(this.headGroup);
      this.segments.push({ mesh: this.headGroup, isHead: true, mat: headMat });
    }

    rebuildMeshes() {
      if (!this.headGroup) this._createHead();

      while (this.segments.length - 1 < this.gridPos.length - 1) {
        const idx = this.segments.length;
        const total = this.gridPos.length;
        const mat = this._bodyMaterial(idx, total);
        const mesh = new THREE.Mesh(this.linkGeo, mat);
        this.group.add(mesh);
        this.segments.push({ mesh, isHead: false, mat, index: idx });
      }

      while (this.segments.length > this.gridPos.length) {
        const s = this.segments.pop();
        if (!s.isHead) {
          this.group.remove(s.mesh);
          s.mat.dispose();
        }
        this.visualPos.pop();
      }

      while (this.visualPos.length < this.gridPos.length) {
        const i = this.visualPos.length;
        const w = gridToWorld(this.gridPos[i].x, this.gridPos[i].z);
        this.visualPos.push({ x: w.x, y: w.y, z: w.z });
      }
    }

    setDirection(dir) {
      if (!DIR[dir]) return;
      const current = this.nextDirection || this.direction;
      if (dir === OPPOSITE[current]) return;
      if (this.nextDirection) return;
      if (dir === current) return;
      this.nextDirection = dir;
    }

    move() {
      if (this.nextDirection) {
        this.direction = this.nextDirection;
        this.nextDirection = null;
      }
      const d = DIR[this.direction];
      const head = this.gridPos[0];
      const newHead = { x: head.x + d.x, z: head.z + d.z };
      this.gridPos.unshift(newHead);
      this.gridPos.pop();

      const tail = this.gridPos[this.gridPos.length - 1];
      const tw = gridToWorld(tail.x, tail.z);
      spawnParticle(tw.x, tw.y, tw.z, COLORS.snakeB, 0.04, 0.35, 0.03);

      this.visualPos.unshift({ ...this.visualPos[0] });
      this.visualPos.pop();
    }

    grow() {
      const tail = this.gridPos[this.gridPos.length - 1];
      this.gridPos.push({ ...tail });
      const vt = this.visualPos[this.visualPos.length - 1];
      this.visualPos.push({ ...vt });
      this.rebuildMeshes();
    }

    _tangentAt(i) {
      const n = this.visualPos.length;
      const cur = this.visualPos[i];
      if (i === 0 && n > 1) {
        return this._tempVec.set(
          this.visualPos[1].x - cur.x,
          0,
          this.visualPos[1].z - cur.z
        ).normalize();
      }
      if (i === n - 1 && n > 1) {
        return this._tempVec.set(
          cur.x - this.visualPos[i - 1].x,
          0,
          cur.z - this.visualPos[i - 1].z
        ).normalize();
      }
      if (n > 1) {
        return this._tempVec.set(
          this.visualPos[i + 1].x - this.visualPos[i - 1].x,
          0,
          this.visualPos[i + 1].z - this.visualPos[i - 1].z
        ).normalize();
      }
      const d = DIR[this.direction];
      return this._tempVec.set(d.x, 0, d.z);
    }

    _slitherOffset(i, tangent) {
      const perpX = -tangent.z;
      const perpZ = tangent.x;
      const wave = Math.sin(this.slitherPhase - i * 0.55) * 0.07;
      const ripple = Math.sin(this.slitherPhase * 1.6 - i * 0.3) * 0.025;
      return {
        x: perpX * wave,
        y: ripple,
        z: perpZ * wave
      };
    }

    _radiusFor(i, total) {
      if (i === 0) return { x: 0.46, y: 0.38, z: 0.62 };
      const t = i / Math.max(total - 1, 1);
      const belly = 0.42 - t * 0.22;
      const side = belly * 0.88;
      const stretch = 0.52 - t * 0.08;
      return { x: side, y: side * 0.82, z: stretch };
    }

    updateVisual(dt) {
      this.shimmerPhase += dt * SHIMMER_SPEED;
      this.slitherPhase += dt * 6;
      this.headPulse += dt * 4;

      const total = this.visualPos.length;

      for (let i = 0; i < total; i++) {
        const target = gridToWorld(this.gridPos[i].x, this.gridPos[i].z);
        const vp = this.visualPos[i];
        vp.x += (target.x - vp.x) * LERP_SPEED;
        vp.y += (target.y - vp.y) * LERP_SPEED;
        vp.z += (target.z - vp.z) * LERP_SPEED;
      }

      for (let i = 0; i < total; i++) {
        const vp = this.visualPos[i];
        const tangent = this._tangentAt(i);
        const off = this._slitherOffset(i, tangent);
        const seg = this.segments[i];
        const px = vp.x + off.x;
        const py = vp.y + off.y;
        const pz = vp.z + off.z;

        seg.mesh.position.set(px, py, pz);

        this._lookTarget.set(px + tangent.x, py, pz + tangent.z);
        seg.mesh.lookAt(this._lookTarget);
        seg.mesh.rotateX(Math.PI / 2);

        if (!seg.isHead) {
          const sc = this._radiusFor(i, total);
          seg.mesh.scale.set(sc.x, sc.z, sc.y);
          const tint = new THREE.Color(COLORS.snakeA).lerp(
            new THREE.Color(COLORS.snakeB),
            i / Math.max(total - 1, 1)
          );
          seg.mat.color.copy(tint);
          seg.mat.emissive.copy(tint);
          seg.mat.emissiveIntensity = 0.7 + Math.sin(this.slitherPhase - i * 0.4) * 0.15;
        }
      }

      this._animateHead();
    }

    _animateHead() {
      if (!this.headGroup) return;

      const flicker = (Math.sin(this.headPulse * 2.2) + 1) * 0.5;
      if (this.tongue) {
        this.tongue.position.z = flicker * 0.12;
        this.tongue.visible = flicker > 0.35;
      }

      const d = DIR[this.direction];
      if (this.eyes && this.eyes.pupilL) {
        this.eyes.pupilL.position.z = 0.04 + flicker * 0.02;
        this.eyes.pupilR.position.z = 0.04 + flicker * 0.02;
      }

      this.headGroup.children[0].material.emissiveIntensity = 1.0 + Math.sin(this.headPulse) * 0.25;
    }

    getHeadGrid() { return this.gridPos[0]; }

    checkSelfCollision() {
      const h = this.gridPos[0];
      for (let i = 1; i < this.gridPos.length; i++) {
        if (this.gridPos[i].x === h.x && this.gridPos[i].z === h.z) return true;
      }
      return false;
    }

    occupies(x, z) {
      return this.gridPos.some(p => p.x === x && p.z === z);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. FOOD CLASS
  // ═══════════════════════════════════════════════════════════
  class Food {
    constructor() {
      this.group = new THREE.Group();
      scene.add(this.group);

      this.mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.38, 1),
        new THREE.MeshStandardMaterial({
          color: COLORS.food,
          emissive: COLORS.food,
          emissiveIntensity: 1.5,
          metalness: 0.5,
          roughness: 0.2
        })
      );
      this.group.add(this.mesh);

      this.orbitParticles = [];
      const orbitCount = 10;
      for (let i = 0; i < orbitCount; i++) {
        const p = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 6, 6),
          new THREE.MeshBasicMaterial({ color: COLORS.foodOrbit, transparent: true, opacity: 0.85 })
        );
        this.group.add(p);
        this.orbitParticles.push({ mesh: p, angle: (i / orbitCount) * Math.PI * 2 });
      }

      this.light = new THREE.PointLight(COLORS.food, 1.2, 8);
      this.group.add(this.light);

      this.gridX = 0;
      this.gridZ = 0;
      this.bobPhase = 0;
      this.baseY = 0.55;
    }

    spawn(snake) {
      let attempts = 0;
      do {
        this.gridX = Math.floor(Math.random() * GRID);
        this.gridZ = Math.floor(Math.random() * GRID);
        attempts++;
      } while (snake.occupies(this.gridX, this.gridZ) && attempts < 500);
      this.updatePosition(0);
    }

    updatePosition(time) {
      const w = gridToWorld(this.gridX, this.gridZ);
      this.bobPhase = time * 2.5;
      const bob = Math.sin(this.bobPhase) * 0.12;
      this.group.position.set(w.x, this.baseY + bob, w.z);
      this.mesh.rotation.y = time * 1.8;
      this.mesh.rotation.x = Math.sin(time * 1.2) * 0.3;

      const pulse = 0.8 + Math.sin(time * 4) * 0.4;
      this.light.intensity = pulse * 1.5;

      const orbitR = 0.7;
      for (const op of this.orbitParticles) {
        op.angle += 0.025;
        op.mesh.position.set(
          Math.cos(op.angle) * orbitR,
          Math.sin(op.angle * 2) * 0.15,
          Math.sin(op.angle) * orbitR
        );
      }
    }

    getGridPos() { return { x: this.gridX, z: this.gridZ }; }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. AUDIO ENGINE
  // ═══════════════════════════════════════════════════════════
  const AudioEngine = {
    ctx: null,
    muted: false,
    bgmNodes: [],
    bgmInterval: null,

    init() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    playEat() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      [440, 660].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.06);
        gain.gain.setValueAtTime(0.15, t + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + i * 0.06);
        osc.stop(t + i * 0.06 + 0.15);
      });
    },

    playDeath() {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2000, t);
      filter.frequency.exponentialRampToValueAtTime(100, t + 0.3);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);

      const noise = this.ctx.createBufferSource();
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.15, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
      noise.buffer = buf;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.08, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      noise.connect(nGain);
      nGain.connect(this.ctx.destination);
      noise.start(t);
    },

    startBGM() {
      if (this.muted || !this.ctx) return;
      this.stopBGM();
      const notes = [110, 130.81, 164.81, 196, 220, 261.63];
      let step = 0;

      const playArp = () => {
        if (this.muted) return;
        const t = this.ctx.currentTime;
        const freq = notes[step % notes.length];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq * 2;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.04, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
        step++;
      };

      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      const bassFilter = this.ctx.createBiquadFilter();
      bassOsc.type = 'sine';
      bassOsc.frequency.value = 55;
      bassFilter.type = 'lowpass';
      bassFilter.frequency.value = 200;
      bassGain.gain.value = 0.08;
      bassOsc.connect(bassFilter);
      bassFilter.connect(bassGain);
      bassGain.connect(this.ctx.destination);
      bassOsc.start();
      this.bgmNodes.push(bassOsc, bassGain, bassFilter);

      playArp();
      this.bgmInterval = setInterval(playArp, 400);
    },

    stopBGM() {
      if (this.bgmInterval) {
        clearInterval(this.bgmInterval);
        this.bgmInterval = null;
      }
      for (const node of this.bgmNodes) {
        try { node.stop && node.stop(); node.disconnect(); } catch (_) {}
      }
      this.bgmNodes = [];
    },

    toggleMute() {
      this.muted = !this.muted;
      if (this.muted) this.stopBGM();
      else if (gameState === 'PLAYING') this.startBGM();
      return this.muted;
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 7. INPUT HANDLER
  // ═══════════════════════════════════════════════════════════
  const Input = {
    keyMap: {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right'
    },

    init(snake) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (gameState === 'IDLE' || gameState === 'DEAD') startGame();
          return;
        }
        const dir = this.keyMap[e.key];
        if (dir) {
          e.preventDefault();
          snake.setDirection(dir);
        }
      });

      document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
        const handle = (e) => {
          e.preventDefault();
          snake.setDirection(btn.dataset.dir);
          btn.classList.add('active');
          setTimeout(() => btn.classList.remove('active'), 150);
        };
        btn.addEventListener('touchstart', handle, { passive: false });
        btn.addEventListener('mousedown', handle);
      });
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 9. UI CONTROLLER
  // ═══════════════════════════════════════════════════════════
  const UI = {
    scoreEl: document.getElementById('score-value'),
    highEl: document.getElementById('high-value'),
    levelEl: document.getElementById('level-display'),
    titleOverlay: document.getElementById('title-overlay'),
    gameoverOverlay: document.getElementById('gameover-overlay'),
    goScore: document.getElementById('go-score'),
    goHigh: document.getElementById('go-high'),
    muteBtn: document.getElementById('mute-btn'),
    highScore: 0,

    init() {
      this.highScore = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
      this.highEl.textContent = this.highScore;
      this.muteBtn.addEventListener('click', () => {
        const muted = AudioEngine.toggleMute();
        this.muteBtn.textContent = muted ? '🔇' : '🔊';
      });
      document.getElementById('restart-btn').addEventListener('click', () => {
        this.hideGameOver();
        startGame();
      });
    },

    setScore(s) { this.scoreEl.textContent = s; },
    setLevel(l) { this.levelEl.textContent = 'LEVEL ' + l; },

    updateHigh(s) {
      if (s > this.highScore) {
        this.highScore = s;
        localStorage.setItem(HS_KEY, String(s));
        this.highEl.textContent = s;
      }
    },

    showTitle() { this.titleOverlay.classList.remove('hidden'); },
    hideTitle() { this.titleOverlay.classList.add('hidden'); },

    showGameOver(score) {
      this.goScore.textContent = score;
      this.goHigh.textContent = this.highScore;
      this.gameoverOverlay.classList.remove('hidden');
    },

    hideGameOver() { this.gameoverOverlay.classList.add('hidden'); }
  };

  // ═══════════════════════════════════════════════════════════
  // TITLE LOGO
  // ═══════════════════════════════════════════════════════════
  const logoCanvas = document.getElementById('logo-canvas');
  const logoRenderer = new THREE.WebGLRenderer({ canvas: logoCanvas, alpha: true, antialias: true });
  logoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const logoScene = new THREE.Scene();
  const logoCam = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  logoCam.position.z = 5;
  const logoGroup = new THREE.Group();
  logoScene.add(logoGroup);

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const c = new THREE.Color(COLORS.snakeA).lerp(new THREE.Color(COLORS.snakeB), i / 12);
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1 })
    );
    s.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0);
    logoGroup.add(s);
  }
  logoScene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const logoLight = new THREE.PointLight(COLORS.border, 1, 10);
  logoLight.position.set(2, 2, 3);
  logoScene.add(logoLight);

  function resizeLogo() {
    const size = logoCanvas.clientWidth;
    if (size > 0) {
      logoRenderer.setSize(size, size);
      logoCam.aspect = 1;
      logoCam.updateProjectionMatrix();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 8. GAME STATE MACHINE
  // ═══════════════════════════════════════════════════════════
  let gameState = 'IDLE';
  let score = 0;
  let level = 1;
  let tickInterval = TICK_START;
  let tickTimer = null;
  let animTime = 0;
  let lastFrame = performance.now();

  const snake = new Snake();
  const food = new Food();
  snake.group.visible = false;
  food.group.visible = false;

  function isWallCollision(gx, gz) {
    return gx < 0 || gx >= GRID || gz < 0 || gz >= GRID;
  }

  function startGame() {
    AudioEngine.init();
    gameState = 'PLAYING';
    score = 0;
    level = 1;
    tickInterval = TICK_START;
    snake.reset();
    snake.group.visible = true;
    food.group.visible = true;
    food.spawn(snake);
    UI.setScore(0);
    UI.setLevel(1);
    UI.hideTitle();
    UI.hideGameOver();
    resetTick();
    if (!AudioEngine.muted) AudioEngine.startBGM();
  }

  function gameOver() {
    gameState = 'DEAD';
    clearInterval(tickTimer);
    tickTimer = null;
    AudioEngine.stopBGM();
    AudioEngine.playDeath();
    UI.updateHigh(score);
    setTimeout(() => UI.showGameOver(score), 400);
  }

  function resetTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(gameTick, tickInterval);
  }

  // ═══════════════════════════════════════════════════════════
  // 11. GAME TICK
  // ═══════════════════════════════════════════════════════════
  function gameTick() {
    if (gameState !== 'PLAYING') return;

    snake.move();
    const head = snake.getHeadGrid();

    if (isWallCollision(head.x, head.z) || snake.checkSelfCollision()) {
      const hw = gridToWorld(head.x, head.z);
      spawnBurst(hw.x, hw.y, hw.z, COLORS.food, 18);
      gameOver();
      return;
    }

    const fp = food.getGridPos();
    if (head.x === fp.x && head.z === fp.z) {
      snake.grow();
      score++;
      UI.setScore(score);
      UI.updateHigh(score);

      const fw = gridToWorld(fp.x, fp.z);
      spawnBurst(fw.x, fw.y, fw.z, COLORS.food, 16);
      AudioEngine.playEat();
      food.spawn(snake);

        if (score % FOODS_PER_LEVEL === 0) {
          level++;
          UI.setLevel(level);
          tickInterval = Math.max(TICK_MIN, TICK_START - level * TICK_DECREASE);
          resetTick();
        }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 10. ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);

    const aspect = w / h;
    const size = ORTHO_SIZE;
    camera.left = -size * aspect;
    camera.right = size * aspect;
    camera.top = size;
    camera.bottom = -size;
    camera.updateProjectionMatrix();

    resizeLogo();
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    animTime += dt;

    camera.position.set(0, 20, 0);
    camera.lookAt(0, 0, 0);

    if (gameState === 'PLAYING' || gameState === 'DEAD') {
      snake.updateVisual(dt);
      food.updatePosition(animTime);
    }

    updateParticles(dt);

    logoGroup.rotation.z = animTime * 0.8;
    logoRenderer.render(logoScene, logoCam);
    renderer.render(scene, camera);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  UI.init();
  Input.init(snake);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(animate);

})();
