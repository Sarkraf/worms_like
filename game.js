/* ============================================================
   PRISME — Duel d'artillerie (jeu original)
   HTML5 Canvas 2D · JavaScript vanilla · aucun asset externe
   ------------------------------------------------------------
   Sommaire :
     1. Constantes et utilitaires
     2. Terrain destructible
     3. Audio procédural
     4. Particules et effets
     5. Unités et projectiles
     6. Intelligence artificielle
     7. Jeu (boucle, tours, règles)
     8. Rendu (décor, unités, visée)
     9. Interface (HUD, menus)
    10. Entrées clavier / souris et démarrage
   ============================================================ */
(() => {
  'use strict';

  /* ============================================================
     1. CONSTANTES ET UTILITAIRES
     ============================================================ */

  const WORLD = Object.freeze({ width: 1280, height: 720 });
  const CELL = 16;                             // côté d'un bloc de terrain
  const COLS = WORLD.width / CELL;             // 80 colonnes
  const ROWS = WORLD.height / CELL;            // 45 rangées
  const GRAVITY = 1650;                        // gravité des projectiles (px/s²)
  const WIND_FORCE = 108;                      // poussée du vent à 100 %
  const AIM_MIN_SPEED = 250;                   // vitesse pour une puissance minimale
  const AIM_MAX_SPEED = 1180;                  // vitesse pour une puissance maximale
  const PHYSICS_STEP = 1 / 120;                // pas fixe de la physique des projectiles
  const MOVE_BUDGET = 150;                     // distance de marche par tour (px)
  const WALK_SPEED = 148;                      // vitesse de marche (px/s)
  const STEP_UP = 26;                          // hauteur franchie sans bloquer
  const STEP_DOWN = 38;                        // dénivelé descendant franchissable
  const FALL_DAMAGE_SPEED = 500;               // vitesse d'impact avant dégâts de chute
  const MAX_ROUNDS = 20;                       // garde-fou : fin de partie aux points
  const TAU = Math.PI * 2;

  // --- Petites fonctions utilitaires -------------------------------
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const toRad = (deg) => (deg * Math.PI) / 180;

  // Hash déterministe : sert à varier les teintes des blocs.
  function hash2(x, y, seed = 0) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695040);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  // --- Matériaux du terrain ----------------------------------------
  const MAT = { GRASS: 1, SOIL: 2, ROCK: 3 };

  // --- Définition des équipes --------------------------------------
  const TEAM_DEFS = [
    {
      id: 'prism',
      name: 'Prisme',
      color: '#37bdb3',
      dark: '#1c857f',
      light: '#b7f0ea',
      shapes: ['triangle', 'diamond', 'hexagon', 'pentagon'],
      names: ['Éclat', 'Facette', 'Prisme', 'Reflet']
    },
    {
      id: 'amber',
      name: 'Ambre',
      color: '#ff9a76',
      dark: '#cf6244',
      light: '#ffddcd',
      shapes: ['square', 'inverted', 'octagon', 'star'],
      names: ['Tison', 'Braise', 'Ambre', 'Cendre']
    }
  ];

  // --- Arsenal (armes originales, munitions limitées) --------------
  const WEAPONS = {
    orb: {
      id: 'orb', name: 'Orbe', icon: 'circle',
      ammo: 6, color: '#ffd166', dark: '#b5871f',
      radius: 7, gravity: 1, wind: 1, bounce: 0, fuse: null,
      damage: 34, blast: 46, carve: 50
    },
    grenade: {
      id: 'grenade', name: 'Grenade', icon: 'square',
      ammo: 3, color: '#9de3a6', dark: '#569b60',
      radius: 8, gravity: 0.92, wind: 1.2, bounce: 0.44, fuse: 2.6,
      damage: 42, blast: 60, carve: 64
    },
    meteor: {
      id: 'meteor', name: 'Météore', icon: 'diamond',
      ammo: 1, color: '#ffb2a0', dark: '#c9614b',
      radius: 10, gravity: 1.35, wind: 0.35, bounce: 0, fuse: null,
      damage: 58, blast: 74, carve: 82
    }
  };
  const WEAPON_ORDER = ['orb', 'grenade', 'meteor'];

  /* ============================================================
     2. TERRAIN DESTRUCTIBLE
     Grille de blocs ; les blocs non soutenus s'effondrent.
     ============================================================ */

  class Terrain {
    constructor() {
      this.cells = new Uint8Array(COLS * ROWS);
      this.surface = new Int16Array(COLS).fill(-1);
      this.seed = 1;
      // Calque hors écran : le décor n'est redessiné qu'à la destruction.
      this.canvas = document.createElement('canvas');
      this.canvas.width = WORLD.width;
      this.canvas.height = WORLD.height;
      this.ctx = this.canvas.getContext('2d');
    }

    index(c, r) { return r * COLS + c; }

    /** Génère deux plateaux surélevés, une vallée centrale et une butte. */
    generate(seed) {
      this.seed = seed >>> 0;
      this.cells.fill(0);
      const heights = new Float32Array(COLS);

      for (let c = 0; c < COLS; c++) {
        const t = c / (COLS - 1);
        let y = 520 - 62 * Math.cos(t * TAU);                // bords hauts, centre bas
        y -= 44 * Math.exp(-Math.pow((t - 0.5) / 0.075, 2)); // butte centrale
        y += 11 * Math.cos(t * TAU * 3 + 0.7);               // ondulations douces
        y += 6 * Math.cos(t * TAU * 7 + 2.1);
        heights[c] = y;
      }

      for (let c = 0; c < COLS; c++) {
        const topRow = clamp(Math.round(heights[c] / CELL), 3, ROWS - 4);
        for (let r = topRow; r < ROWS; r++) {
          const depth = r - topRow;
          let material;
          if (depth === 0) material = MAT.GRASS;
          else if (depth <= 2) material = MAT.SOIL;
          else material = MAT.ROCK;
          // Quelques filons de roche dans la terre pour varier.
          if (depth > 5 && depth < 12 && hash2(c, r, this.seed + 91) > 0.74) material = MAT.ROCK;
          if (r >= ROWS - 2) material = MAT.ROCK;
          this.cells[this.index(c, r)] = material;
        }
      }

      this.updateSurface();
      this.render();
    }

    /** Recalcule la première rangée solide de chaque colonne. */
    updateSurface() {
      for (let c = 0; c < COLS; c++) {
        let top = -1;
        for (let r = 0; r < ROWS; r++) {
          if (this.cells[this.index(c, r)]) { top = r; break; }
        }
        this.surface[c] = top;
      }
    }

    /** Altitude (en pixels) du dessus du sol pour une abscisse donnée. */
    surfaceY(x) {
      const c = clamp(Math.floor(x / CELL), 0, COLS - 1);
      const r = this.surface[c];
      return r < 0 ? WORLD.height : r * CELL;
    }

    isSolidAt(x, y) {
      if (y < 0 || x < 0 || x >= WORLD.width || y >= WORLD.height) return false;
      return this.cells[this.index(Math.floor(x / CELL), Math.floor(y / CELL))] !== 0;
    }

    /**
     * Creuse un cratère circulaire (la roche résiste un peu plus).
     * @returns {number} nombre de blocs détruits
     */
    carve(cx, cy, radius) {
      const c0 = clamp(Math.floor((cx - radius) / CELL), 0, COLS - 1);
      const c1 = clamp(Math.floor((cx + radius) / CELL), 0, COLS - 1);
      const r0 = clamp(Math.floor((cy - radius) / CELL), 0, ROWS - 1);
      const r1 = clamp(Math.floor((cy + radius) / CELL), 0, ROWS - 1);
      let removed = 0;

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = this.index(c, r);
          const material = this.cells[i];
          if (!material) continue;
          const px = c * CELL + CELL / 2;
          const py = r * CELL + CELL / 2;
          const d = Math.hypot(px - cx, py - cy);
          const hardness = material === MAT.ROCK ? 0.8 : 1;
          if (d <= radius * hardness) {
            this.cells[i] = 0;
            removed++;
          }
        }
      }

      if (removed > 0) {
        this.settle();
        this.updateSurface();
        this.render();
      }
      return removed;
    }

    /**
     * Effondrement : dans chaque colonne, les blocs tombent au sol.
     * @returns {number} hauteur de chute maximale (px)
     */
    settle() {
      let maxDrop = 0;
      for (let c = 0; c < COLS; c++) {
        let write = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          const material = this.cells[this.index(c, r)];
          if (!material) continue;
          if (r !== write) {
            this.cells[this.index(c, write)] = material;
            this.cells[this.index(c, r)] = 0;
            maxDrop = Math.max(maxDrop, write - r);
          }
          write--;
        }
      }
      return maxDrop;
    }

    /** Dessine le terrain sur le calque hors écran. */
    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, WORLD.width, WORLD.height);

      // --- Blocs ---
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const material = this.cells[this.index(c, r)];
          if (!material) continue;
          const x = c * CELL;
          const y = r * CELL;
          const n = hash2(c, r, this.seed);
          let color;
          if (material === MAT.ROCK) color = n > 0.5 ? '#b7b2d0' : '#aca7c8';
          else if (material === MAT.SOIL) color = n > 0.5 ? '#e8c3a0' : '#e0b995';
          else color = n > 0.5 ? '#a6e3b5' : '#9cdcad';
          ctx.fillStyle = color;
          ctx.fillRect(x, y, CELL, CELL);

          // Facette claire low-poly sur certains blocs.
          if (n > 0.62) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.beginPath();
            ctx.moveTo(x, y + CELL);
            ctx.lineTo(x, y);
            ctx.lineTo(x + CELL, y);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // --- Liserés de surface ---
      for (let c = 0; c < COLS; c++) {
        const top = this.surface[c];
        if (top < 0) continue;
        const x = c * CELL;
        const y = top * CELL;
        const material = this.cells[this.index(c, top)];
        if (material === MAT.GRASS) {
          ctx.fillStyle = '#83ce9a';
          ctx.fillRect(x, y, CELL, 4);
          // Brins d'herbe dessinés au-dessus du bloc.
          if (hash2(c, 7, this.seed) > 0.42) {
            ctx.strokeStyle = 'rgba(110, 190, 132, 0.9)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let k = 0; k < 3; k++) {
              const bx = x + 3 + k * 5 + hash2(c, k + 3, this.seed) * 2;
              const bh = 3 + hash2(c, k + 11, this.seed) * 3;
              ctx.moveTo(bx, y + 1);
              ctx.lineTo(bx + (hash2(c, k + 5, this.seed) - 0.5) * 4, y - bh);
            }
            ctx.stroke();
          }
        } else if (material === MAT.SOIL) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
          ctx.fillRect(x, y, CELL, 3);
        } else {
          ctx.fillStyle = '#cbc6e6';
          ctx.fillRect(x, y, CELL, 3);
        }
      }

      // --- Ombre de profondeur ---
      const shade = ctx.createLinearGradient(0, 340, 0, WORLD.height);
      shade.addColorStop(0, 'rgba(30, 38, 70, 0)');
      shade.addColorStop(1, 'rgba(30, 38, 70, 0.22)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    }
  }


  /* ============================================================
     3. AUDIO PROCÉDURAL
     Tous les sons sont synthétisés (oscillateurs + bruit blanc).
     ============================================================ */

  const AudioSys = {
    ctx: null,
    master: null,
    noiseBuffer: null,
    muted: false,

    /** Crée le contexte audio au premier geste utilisateur. */
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);

      // Bruit blanc réutilisable pour les explosions et impacts.
      const frames = Math.floor(this.ctx.sampleRate * 1.2);
      const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    },

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.32;
    },

    tone(freq, duration, type = 'sine', gain = 0.15, slideTo = null, delay = 0) {
      if (!this.ctx || this.muted) return;
      const start = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(g).connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    },

    noise(duration, gain, freqStart, freqEnd, delay = 0) {
      if (!this.ctx || this.muted || !this.noiseBuffer) return;
      const start = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freqStart, start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, freqEnd), start + duration);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      src.connect(filter).connect(g).connect(this.master);
      src.start(start);
      src.stop(start + duration + 0.03);
    },

    shoot(weaponId) {
      if (weaponId === 'meteor') {
        this.tone(190, 0.24, 'sawtooth', 0.12, 70);
        this.noise(0.2, 0.14, 1800, 300);
      } else if (weaponId === 'grenade') {
        this.tone(420, 0.14, 'triangle', 0.09, 180);
        this.noise(0.12, 0.08, 2400, 700);
      } else {
        this.tone(620, 0.1, 'triangle', 0.1, 250);
        this.noise(0.09, 0.07, 3000, 900);
      }
    },

    explosion(weaponId) {
      const big = weaponId === 'meteor';
      this.noise(big ? 0.85 : 0.5, big ? 0.5 : 0.36, big ? 1400 : 1100, 70);
      this.tone(big ? 95 : 130, big ? 0.55 : 0.34, 'sine', big ? 0.32 : 0.2, 32);
      if (big) this.tone(58, 0.7, 'triangle', 0.18, 28);
    },

    bounce() {
      this.tone(rand(560, 820), 0.06, 'triangle', 0.06, 320);
    },

    thud() {
      this.tone(150, 0.16, 'sine', 0.14, 48);
      this.noise(0.1, 0.08, 600, 120);
    },

    ui() {
      this.tone(680, 0.045, 'square', 0.035, 820);
    },

    victory() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        this.tone(f, 0.32, 'triangle', 0.11, null, i * 0.13);
        this.tone(f / 2, 0.36, 'sine', 0.06, null, i * 0.13);
      });
    }
  };


  /* ============================================================
     4. PARTICULES ET EFFETS
     ============================================================ */

  const Particles = {
    list: [],
    max: 520,

    clear() { this.list.length = 0; },

    add(particle) {
      if (this.list.length < this.max) this.list.push(particle);
    },

    /** Gerbe de petits éclats colorés. */
    burst(x, y, color, count, speed, options = {}) {
      for (let i = 0; i < count; i++) {
        const angle = rand(0, TAU);
        const s = rand(speed * 0.25, speed);
        const life = rand(0.35, 0.95);
        this.add({
          kind: options.kind || 'shard',
          x, y,
          vx: Math.cos(angle) * s,
          vy: Math.sin(angle) * s - (options.lift || 0),
          life,
          maxLife: life,
          size: rand(2, 5),
          color,
          gravity: options.gravity !== undefined ? options.gravity : 900,
          drag: 0.8,
          rot: rand(0, TAU),
          spin: rand(-9, 9)
        });
      }
    },

    /** Explosion complète : éclats, étincelles, fumée, poussière. */
    explosion(x, y, weapon) {
      this.burst(x, y, weapon.color, 24, 430);
      this.burst(x, y, '#fff4da', 12, 310, { kind: 'spark', gravity: 520, lift: 40 });
      this.burst(x, y + 10, '#dcb28c', 12, 250, { kind: 'dot', gravity: 1200 });

      for (let i = 0; i < 9; i++) {
        const angle = rand(0, TAU);
        const s = rand(20, 130);
        const life = rand(0.7, 1.5);
        this.add({
          kind: 'smoke',
          x: x + rand(-8, 8),
          y: y + rand(-8, 8),
          vx: Math.cos(angle) * s,
          vy: Math.sin(angle) * s - 45,
          life,
          maxLife: life,
          size: rand(9, 20),
          color: '#f7ecdd',
          gravity: -30,
          drag: 1.6
        });
      }
    },

    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.life -= dt;
        if (p.life <= 0) { this.list.splice(i, 1); continue; }
        p.vy += (p.gravity || 0) * dt;
        const drag = (p.drag || 0) * dt;
        p.vx -= p.vx * drag;
        p.vy -= p.vy * drag * 0.6;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spin) p.rot += p.spin * dt;
        if (p.kind === 'smoke') p.size += 17 * dt;
      }
    },

    draw(ctx) {
      for (const p of this.list) {
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = p.kind === 'smoke' ? alpha * 0.3 : alpha;
        ctx.fillStyle = p.color;

        if (p.kind === 'smoke') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.5, 0, TAU);
          ctx.fill();
        } else if (p.kind === 'dot') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.7, 0, TAU);
          ctx.fill();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }
  };

  const Effects = {
    list: [],

    clear() { this.list.length = 0; },

    ring(x, y, maxRadius, color, duration = 0.55) {
      this.list.push({
        type: 'ring', x, y, maxRadius, color,
        age: 0, duration
      });
    },

    text(x, y, text, color = '#ffffff') {
      this.list.push({
        type: 'text', x, y, text, color,
        age: 0, duration: 0.95, vy: -46
      });
    },

    flash(intensity = 0.16) {
      this.list.push({ type: 'flash', age: 0, duration: 0.32, intensity });
    },

    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const e = this.list[i];
        e.age += dt;
        if (e.type === 'text') e.y += e.vy * dt;
        if (e.age >= e.duration) this.list.splice(i, 1);
      }
    },

    draw(ctx) {
      for (const e of this.list) {
        const t = clamp(e.age / e.duration, 0, 1);
        if (e.type === 'ring') {
          const r = e.maxRadius * (1 - Math.pow(1 - t, 2));
          ctx.globalAlpha = (1 - t) * 0.55;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 3 * (1 - t) + 1;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, TAU);
          ctx.stroke();
        } else if (e.type === 'text') {
          ctx.globalAlpha = 1 - t * t;
          ctx.font = '800 15px "Trebuchet MS", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(30, 42, 66, 0.55)';
          ctx.strokeText(e.text, e.x, e.y);
          ctx.fillStyle = e.color;
          ctx.fillText(e.text, e.x, e.y);
        } else if (e.type === 'flash') {
          ctx.globalAlpha = (1 - t) * e.intensity;
          ctx.fillStyle = '#fff7e8';
          ctx.fillRect(0, 0, WORLD.width, WORLD.height);
        }
      }
      ctx.globalAlpha = 1;
    }
  };


  /* ============================================================
     5. UNITÉS ET PROJECTILES
     ============================================================ */

  class Unit {
    constructor(team, index, x, y) {
      const definition = TEAM_DEFS[team];
      this.team = team;
      this.index = index;
      this.name = definition.names[index] || `Unité ${index + 1}`;
      this.shape = definition.shapes[index % definition.shapes.length];
      this.x = x;
      this.y = y;
      this.r = 15;
      this.maxHp = 100;
      this.hp = 100;
      this.vx = 0;
      this.vy = 0;
      this.onGround = true;
      this.dead = false;

      // Munitions limitées, propres à chaque unité.
      this.ammo = {};
      for (const id of WEAPON_ORDER) this.ammo[id] = WEAPONS[id].ammo;
      this.weapon = 'orb';

      this.moveLeft = MOVE_BUDGET;
      this.moveTargetX = null;
      this.aimAngle = team === 0 ? toRad(52) : toRad(128);
      this.aimPower = 0.6;
      this.facing = team === 0 ? 1 : -1;
      this.walkPhase = 0;
      this.flash = 0;
    }

    get color() { return TEAM_DEFS[this.team].color; }
    get darkColor() { return TEAM_DEFS[this.team].dark; }
    get lightColor() { return TEAM_DEFS[this.team].light; }
    get alive() { return !this.dead; }

    takeDamage(amount, source = 'impact') {
      if (this.dead) return;
      const damage = Math.max(0, Math.round(amount));
      if (damage <= 0) return;
      this.hp = Math.max(0, this.hp - damage);
      this.flash = 0.3;
      Effects.text(
        this.x + rand(-5, 5),
        this.y - this.r - 10,
        `-${damage}`,
        this.team === 0 ? '#d9fff9' : '#ffe9df'
      );
      UI.markDirty();
      if (this.hp <= 0) this.die();
      else if (source !== 'fall') AudioSys.thud();
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      this.vx = 0;
      this.vy = 0;
      Particles.burst(this.x, this.y, this.color, 30, 330);
      Particles.burst(this.x, this.y, this.lightColor, 16, 190, { kind: 'dot', gravity: 620 });
      Effects.ring(this.x, this.y, 54, this.color, 0.7);
      Effects.text(this.x, this.y - 28, 'K.O.', '#fff3e2');
      Game.shake = Math.max(Game.shake, 0.75);
      AudioSys.thud();
      UI.markDirty();
    }
  }


  class Projectile {
    constructor(owner, weaponId, angle, power, options = {}) {
      this.owner = owner;
      this.weapon = WEAPONS[weaponId];
      this.radius = this.weapon.radius;
      this.angle = angle;
      this.power = power;
      this.simulated = Boolean(options.simulated);
      this.x = options.x !== undefined ? options.x : owner.x;
      this.y = options.y !== undefined ? options.y : owner.y - 4;

      const speed = AIM_MIN_SPEED + (AIM_MAX_SPEED - AIM_MIN_SPEED) * power;
      this.vx = Math.cos(angle) * speed;
      this.vy = -Math.sin(angle) * speed;

      this.age = 0;
      this.fuse = this.weapon.fuse || Infinity;
      this.bounces = 0;
      this.done = false;
      this.exploded = false;
      this.explodeX = 0;
      this.explodeY = 0;
      this.rot = 0;
      this.trail = [];
      this.trailTimer = 0;
    }

    /**
     * Intègre la trajectoire par petits pas pour éviter de traverser
     * les blocs à grande vitesse.
     */
    update(dt, terrain, units) {
      if (this.done) return;
      const speed = Math.hypot(this.vx, this.vy);
      const steps = clamp(Math.ceil((speed * dt) / 5), 1, 12);
      const h = dt / steps;

      for (let i = 0; i < steps; i++) {
        this.age += h;
        this.fuse -= h;
        if (this.fuse <= 0) {
          this.explodeAt(this.x, this.y);
          return;
        }

        this.vy += GRAVITY * this.weapon.gravity * h;
        this.vx += Game.wind * WIND_FORCE * this.weapon.wind * h;

        const prevX = this.x;
        const prevY = this.y;
        this.x += this.vx * h;
        this.y += this.vy * h;
        this.rot += this.vx * h * 0.03;

        // Sortie du monde : le projectile est perdu.
        if (this.x < -120 || this.x > WORLD.width + 120 || this.y > WORLD.height + 120) {
          this.done = true;
          return;
        }

        // Impact sur une unité (le lanceur est ignoré au départ).
        for (const unit of units) {
          if (unit.dead) continue;
          if (unit === this.owner && this.age < 0.22) continue;
          const reach = unit.r + this.radius * 0.6;
          if ((this.x - unit.x) ** 2 + (this.y - unit.y) ** 2 <= reach * reach) {
            this.explodeAt(this.x, this.y);
            return;
          }
        }

        // Impact sur le terrain.
        if (terrain.isSolidAt(this.x, this.y)) {
          if (this.weapon.bounce > 0 && this.bounces < 3) {
            const solidX = terrain.isSolidAt(this.x, prevY);
            const solidY = terrain.isSolidAt(prevX, this.y);
            if (solidX && !solidY) {
              this.x = prevX;
              this.vx *= -this.weapon.bounce;
            } else if (solidY && !solidX) {
              this.y = prevY;
              this.vy *= -this.weapon.bounce;
            } else {
              this.x = prevX;
              this.y = prevY;
              this.vx *= -this.weapon.bounce;
              this.vy *= -this.weapon.bounce;
            }
            this.bounces++;
            this.vx *= 0.92;
            if (!this.simulated) AudioSys.bounce();
            if (Math.hypot(this.vx, this.vy) < 70) this.explodeAt(this.x, this.y);
            return;
          }
          this.explodeAt(this.x, this.y);
          return;
        }
      }

      // Traînée visuelle (inutile pour les simulations de l'IA).
      if (!this.simulated) {
        this.trailTimer += dt;
        if (this.trailTimer > 0.018) {
          this.trailTimer = 0;
          this.trail.push({ x: this.x, y: this.y });
          if (this.trail.length > 55) this.trail.shift();
        }
      }
    }

    explodeAt(x, y) {
      if (this.done) return;
      this.done = true;
      this.exploded = true;
      this.explodeX = x;
      this.explodeY = y;
      if (!this.simulated) Game.detonate(x, y, this.weapon, this.owner);
    }
  }


  /* ============================================================
     6. INTELLIGENCE ARTIFICIELLE
     L'IA simule des tirs avec la même physique que le joueur,
     puis ajoute une imprécision selon le niveau choisi.
     ============================================================ */

  const AI = {
    planShot(unit) {
      const available = WEAPON_ORDER.filter((id) => unit.ammo[id] > 0);
      if (!available.length) return null;

      // 1) Balayage grossier de chaque arme disponible.
      let best = null;
      for (const weaponId of available) {
        const candidate = this.search(unit, weaponId, 8, 0.14);
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (!best) return null;

      // 2) Affinage autour de la meilleure solution.
      const refined = this.search(unit, best.weapon, 2.2, 0.045, best.angle, best.power, 5, 0.07);
      if (refined.score > best.score) best = refined;

      // 3) Imprécision : l'IA reste faillible.
      const spread = lerp(6.5, 1.1, Game.config.aiSkill);
      const angle = clamp(best.angle + toRad(rand(-spread, spread)), toRad(3), toRad(177));
      const power = clamp(best.power + rand(-0.02, 0.02), 0.08, 1);

      return { weapon: best.weapon, angle, power };
    },

    /**
     * Évalue une grille de tirs. Si centerAngle est fourni, la recherche
     * est locale (affinage) au lieu d'être globale.
     */
    search(unit, weaponId, angleStepDeg, powerStep, centerAngle = null, centerPower = null, halfSpanDeg = 5, halfSpanPower = 0.06) {
      const angles = [];
      const powers = [];

      if (centerAngle === null) {
        for (let a = 20; a <= 82; a += angleStepDeg) {
          angles.push(unit.team === 0 ? toRad(a) : toRad(180 - a));
        }
        for (let p = 0.3; p <= 1.0001; p += powerStep) powers.push(p);
      } else {
        for (let d = -halfSpanDeg; d <= halfSpanDeg + 0.001; d += angleStepDeg) {
          angles.push(clamp(centerAngle + toRad(d), toRad(5), toRad(175)));
        }
        for (let d = -halfSpanPower; d <= halfSpanPower + 0.001; d += powerStep) {
          powers.push(clamp(centerPower + d, 0.1, 1));
        }
      }

      let best = {
        score: -Infinity,
        weapon: weaponId,
        angle: centerAngle === null ? angles[0] : centerAngle,
        power: centerPower === null ? powers[0] : centerPower
      };

      for (const angle of angles) {
        for (const power of powers) {
          const shot = Game.makeProjectile(unit, weaponId, angle, power, true);
          for (let i = 0; i < 900 && !shot.done; i++) {
            shot.update(1 / 60, Game.terrain, Game.units);
          }
          if (!shot.exploded) continue;

          let score = this.scoreExplosion(shot.explodeX, shot.explodeY, unit, shot.weapon);
          // On garde les munitions rares pour les bons coups.
          if (weaponId === 'grenade') score -= 3;
          if (weaponId === 'meteor') score -= 6;

          if (score > best.score) best = { score, weapon: weaponId, angle, power };
        }
      }
      return best;
    },

    /** Note une explosion : dégâts infligés, alliés touchés, mises à mort. */
    scoreExplosion(x, y, shooter, weapon) {
      let score = 0;
      for (const target of Game.units) {
        if (target.dead) continue;
        const d = dist(x, y, target.x, target.y);
        const reach = weapon.blast + target.r * 0.5;
        if (d > reach) continue;
        const falloff = Math.pow(1 - d / reach, 0.8);
        const damage = weapon.damage * falloff;

        if (target.team === shooter.team) {
          score -= damage * 1.2;
        } else {
          score += damage * 1.4;
          if (damage >= target.hp) score += 70;
          else if (damage >= target.hp * 0.5) score += 12;
        }
      }
      return score;
    },

    /** Choisit un petit déplacement : reculer si trop près, sinon rester. */
    pickMoveTarget(unit) {
      const enemies = Game.units.filter((u) => u.team !== unit.team && !u.dead);
      if (!enemies.length) return null;

      const nearest = enemies.reduce((a, b) =>
        Math.abs(b.x - unit.x) < Math.abs(a.x - unit.x) ? b : a
      );
      const gap = Math.abs(nearest.x - unit.x);
      let direction = Math.sign(nearest.x - unit.x) || 1;
      let distance = rand(25, 70);

      if (gap < 250) {
        direction *= -1;                   // trop près : on s'éloigne
        distance = rand(20, 55);
      } else if (Math.random() < 0.45) {
        return null;                       // le plus souvent : tir sur place
      }

      const target = clamp(unit.x + direction * distance, 30, WORLD.width - 30);
      return Math.abs(target - unit.x) < 6 ? null : target;
    }
  };


  /* ============================================================
     7. JEU — état, tours et règles
     ============================================================ */

  const Game = {
    terrain: new Terrain(),
    units: [],
    projectiles: [],
    phase: 'boot',            // move | aim | flight | resolve | gameover
    paused: true,
    matchOver: false,
    round: 1,
    wind: 0,
    activeUnit: null,
    turnOrder: [],
    turnIndex: 0,
    config: { unitsPerTeam: 3, aiSkill: 0.8 },
    ai: null,
    time: 0,
    shake: 0,
    acc: 0,
    resolveTimer: 0,
    aimCooldown: 0,
    mouse: { x: WORLD.width / 2, y: WORLD.height / 2, inside: false },
    dragging: false,
    keys: { left: false, right: false, up: false, down: false },

    /* ---------- Cycle de partie ---------- */

    startMatch(options = {}) {
      this.config = {
        unitsPerTeam: clamp(Number(options.unitsPerTeam) || this.config.unitsPerTeam, 2, 4),
        aiSkill: options.aiSkill !== undefined ? clamp(Number(options.aiSkill), 0, 1) : this.config.aiSkill
      };

      this.matchOver = false;
      this.paused = false;
      this.round = 1;
      this.turnIndex = 0;
      this.time = 0;
      this.shake = 0;
      this.acc = 0;
      this.ai = null;
      this.projectiles.length = 0;
      this.activeUnit = null;
      Particles.clear();
      Effects.clear();

      this.terrain.generate(randInt(1, 999999));
      this.units = [];
      this.spawnUnits();
      this.wind = rand(-0.55, 0.55);
      this.buildTurnOrder();

      UI.hideOverlay();
      UI.markDirty();
      UI.refreshAll();
      this.beginTurn(this.turnOrder[0]);
    },

    spawnUnits() {
      const count = this.config.unitsPerTeam;
      for (let team = 0; team < 2; team++) {
        for (let i = 0; i < count; i++) {
          const margin = 82 + i * 64 + (count === 2 ? 26 : 0);
          const x = team === 0 ? margin : WORLD.width - margin;
          const ground = this.terrain.surfaceY(x);
          this.units.push(new Unit(team, i, x, ground - 15));
        }
      }
    },

    /** Ordre alterné : Prisme 1, Ambre 1, Prisme 2, Ambre 2… */
    buildTurnOrder() {
      this.turnOrder = [];
      if (!this.units.length) return;
      const maxUnits = Math.max(...this.units.map((u) => u.index)) + 1;
      for (let i = 0; i < maxUnits; i++) {
        for (let team = 0; team < 2; team++) {
          const unit = this.units.find((u) => u.team === team && u.index === i);
          if (unit && !unit.dead) this.turnOrder.push(unit);
        }
      }
    },

    beginTurn(unit) {
      if (!unit || unit.dead) {
        this.nextTurn();
        return;
      }

      this.activeUnit = unit;
      this.phase = 'move';
      this.aimCooldown = 0.15;
      unit.moveLeft = MOVE_BUDGET;
      unit.moveTargetX = null;
      unit.vx = 0;
      unit.vy = 0;
      unit.aimPower = 0.6;
      unit.aimAngle = unit.team === 0 ? toRad(52) : toRad(128);
      unit.onGround = true;

      if (!unit.weapon || unit.ammo[unit.weapon] <= 0) {
        unit.weapon = WEAPON_ORDER.find((id) => unit.ammo[id] > 0) || null;
      }

      this.ai = unit.team === 1 ? { stage: 'think', timer: 0.8 } : null;

      UI.markDirty();
      UI.refreshAll();
      UI.toast(`${unit.name} · ${TEAM_DEFS[unit.team].name}${unit.team === 1 ? ' (IA)' : ''}`);
      AudioSys.ui();
    },


    nextTurn() {
      if (this.matchOver) return;
      this.ai = null;
      this.projectiles.length = 0;

      if (this.checkVictory()) return;

      let guard = 0;
      do {
        this.turnIndex++;
        if (this.turnIndex >= this.turnOrder.length) {
          this.round++;
          if (this.round > MAX_ROUNDS) {
            this.endByPoints();
            return;
          }
          this.wind = clamp(this.wind + rand(-0.5, 0.5), -1, 1);
          this.buildTurnOrder();
          this.turnIndex = 0;
          if (!this.turnOrder.length) {
            this.checkVictory();
            return;
          }
        }
        guard++;
      } while (this.turnOrder[this.turnIndex] && this.turnOrder[this.turnIndex].dead && guard < 60);

      const next = this.turnOrder[this.turnIndex];
      if (!next) {
        this.endByPoints();
        return;
      }
      this.beginTurn(next);
    },

    confirmMove() {
      const unit = this.activeUnit;
      if (!unit || this.phase !== 'move') return;
      unit.moveTargetX = null;
      this.phase = 'aim';
      this.aimCooldown = 0.2;

      if (!unit.weapon || unit.ammo[unit.weapon] <= 0) {
        unit.weapon = WEAPON_ORDER.find((id) => unit.ammo[id] > 0) || null;
      }

      UI.markDirty();
      UI.refreshAll();

      if (!unit.weapon) {
        UI.toast(`${unit.name} n'a plus de munitions — fin du tour`);
        this.queueNextTurn(0.8);
      }
    },

    selectWeapon(id) {
      const unit = this.activeUnit;
      if (!unit || unit.dead || !WEAPONS[id]) return;
      if (this.phase !== 'aim' && this.phase !== 'move') return;
      if (unit.team !== 0) return;
      if (unit.ammo[id] <= 0) return;
      if (unit.weapon === id) return;
      unit.weapon = id;
      AudioSys.ui();
      UI.markDirty();
      UI.refreshAll();
    },

    /** Prépare un projectile, en dégageant le point de départ du décor. */
    makeProjectile(unit, weaponId, angle, power, simulated = false) {
      let x = unit.x + Math.cos(angle) * (unit.r + 8);
      let y = unit.y - 3 - Math.sin(angle) * (unit.r + 8);
      let guard = 0;
      while (this.terrain.isSolidAt(x, y) && guard++ < 14) y -= 8;
      return new Projectile(unit, weaponId, angle, power, { simulated, x, y });
    },

    fire(angle, power) {
      const unit = this.activeUnit;
      if (!unit || unit.dead || this.phase !== 'aim' || this.aimCooldown > 0) return;

      const weaponId = unit.weapon;
      if (!weaponId || unit.ammo[weaponId] <= 0) return;

      const aimAngle = clamp(angle, toRad(3), toRad(177));
      const aimPower = clamp(power, 0.08, 1);

      unit.ammo[weaponId]--;
      unit.aimAngle = aimAngle;
      unit.aimPower = aimPower;
      unit.facing = Math.cos(aimAngle) >= 0 ? 1 : -1;
      unit.moveTargetX = null;

      this.projectiles.push(this.makeProjectile(unit, weaponId, aimAngle, aimPower));
      this.phase = 'flight';
      this.aimCooldown = 0.4;
      this.shake = Math.max(this.shake, 0.22);

      AudioSys.shoot(weaponId);
      UI.markDirty();
      UI.refreshAll();
      UI.toast(`${unit.name} tire — ${WEAPONS[weaponId].name}`);
    },

    endTurn() {
      if (!this.activeUnit) return;
      if (this.phase !== 'move' && this.phase !== 'aim') return;
      this.activeUnit.moveTargetX = null;
      AudioSys.ui();
      this.queueNextTurn(0.15);
    },

    queueNextTurn(delay) {
      this.phase = 'resolve';
      this.resolveTimer = delay;
      this.ai = null;
      UI.markDirty();
      UI.refreshAll();
    },

    /* ---------- Boucle et phases ---------- */

    update(dt) {
      if (this.paused) {
        this.acc = 0;
        return;
      }

      this.time += dt;
      this.aimCooldown = Math.max(0, this.aimCooldown - dt);
      this.shake = Math.max(0, this.shake - dt * 2.2);

      // Projectiles : pas fixe pour une trajectoire stable et prévisible.
      this.acc += dt;
      let guard = 0;
      while (this.acc >= PHYSICS_STEP && guard++ < 14) {
        this.updateProjectiles(PHYSICS_STEP);
        this.acc -= PHYSICS_STEP;
      }
      if (guard >= 14) this.acc = 0;

      this.updateUnits(dt);
      Particles.update(dt);
      Effects.update(dt);

      switch (this.phase) {
        case 'move': this.updateMovePhase(dt); break;
        case 'aim': this.updateAimPhase(dt); break;
        case 'flight': this.updateFlightPhase(); break;
        case 'resolve': this.updateResolvePhase(dt); break;
        default: break;
      }

      UI.tick();
    },

    updateMovePhase(dt) {
      const unit = this.activeUnit;
      if (!unit || unit.dead) return;
      if (unit.team === 1) {
        this.updateAI(dt);
        return;
      }

      if (this.keys.left || this.keys.right) {
        unit.moveTargetX = null;
        this.walkUnit(unit, (this.keys.right ? 1 : -1) * WALK_SPEED * dt);
      } else if (unit.moveTargetX !== null) {
        this.walkToTarget(unit, dt);
      }
    },

    updateAimPhase(dt) {
      const unit = this.activeUnit;
      if (!unit || unit.dead) return;
      if (unit.team === 1) {
        this.updateAI(dt);
        return;
      }

      // Flèches haut/bas : angle. Gauche/droite : puissance.
      if (this.keys.up) unit.aimAngle = clamp(unit.aimAngle + toRad(62) * dt, toRad(3), toRad(177));
      if (this.keys.down) unit.aimAngle = clamp(unit.aimAngle - toRad(62) * dt, toRad(3), toRad(177));
      if (this.keys.left) unit.aimPower = clamp(unit.aimPower - 0.5 * dt, 0.06, 1);
      if (this.keys.right) unit.aimPower = clamp(unit.aimPower + 0.5 * dt, 0.06, 1);
    },

    /* ---------- Tour de l'IA ---------- */

    updateAI(dt) {
      const ai = this.ai;
      const unit = this.activeUnit;
      if (!ai || !unit || unit.dead) return;

      if (ai.stage === 'think') {
        ai.timer -= dt;
        if (ai.timer > 0) return;

        const target = AI.pickMoveTarget(unit);
        if (target !== null && Math.abs(target - unit.x) > 4) {
          unit.moveTargetX = target;
          ai.stage = 'walk';
          ai.timer = 2.8;
        } else {
          this.startAiAim();
        }
        return;
      }

      if (ai.stage === 'walk') {
        ai.timer -= dt;
        this.walkToTarget(unit, dt);
        if (unit.moveTargetX === null || unit.moveLeft <= 0.5 || ai.timer <= 0) {
          unit.moveTargetX = null;
          this.startAiAim();
        }
        return;
      }

      if (ai.stage === 'aim') {
        ai.timer -= dt;
        if (ai.timer > 0) return;
        if (unit.weapon && unit.ammo[unit.weapon] > 0) {
          this.fire(unit.aimAngle, unit.aimPower);
        } else {
          this.endTurn();
        }
      }
    },

    startAiAim() {
      const unit = this.activeUnit;
      if (!unit) return;

      this.phase = 'aim';
      this.aimCooldown = 0;
      const plan = AI.planShot(unit);

      if (plan && plan.weapon && unit.ammo[plan.weapon] > 0) {
        unit.weapon = plan.weapon;
        unit.aimAngle = plan.angle;
        unit.aimPower = plan.power;
        this.ai = { stage: 'aim', timer: 1.1 };
        UI.toast(`${unit.name} ajuste son tir…`);
      } else {
        this.ai = { stage: 'aim', timer: 0.5 };
      }

      UI.markDirty();
      UI.refreshAll();
    },

    /* ---------- Déplacement ---------- */

    /** Avance l'unité de `delta` pixels signés si le terrain le permet. */
    walkUnit(unit, delta) {
      if (!unit || unit.dead || unit.moveLeft <= 0 || !unit.onGround) return;
      const distance = Math.min(Math.abs(delta), unit.moveLeft);
      if (distance < 0.01) return;

      const direction = Math.sign(delta);
      const nextX = clamp(unit.x + direction * distance, unit.r + 6, WORLD.width - unit.r - 6);
      const moved = Math.abs(nextX - unit.x);
      if (moved < 0.01) {
        unit.moveTargetX = null;
        return;
      }

      const ground = this.terrain.surfaceY(nextX);
      const feet = unit.y + unit.r;
      if (ground < feet - STEP_UP || ground > feet + STEP_DOWN) {
        unit.moveTargetX = null;      // mur trop haut ou falaise
        return;
      }

      // On ne traverse pas une autre unité.
      for (const other of this.units) {
        if (other === unit || other.dead) continue;
        if (Math.abs(other.x - nextX) < unit.r + other.r * 0.7 && Math.abs(other.y - unit.y) < 34) {
          unit.moveTargetX = null;
          return;
        }
      }

      unit.x = nextX;
      unit.y = ground - unit.r;
      unit.vy = 0;
      unit.onGround = true;
      unit.moveLeft = Math.max(0, unit.moveLeft - moved);
      unit.walkPhase += moved;
      unit.facing = direction >= 0 ? 1 : -1;
      if (unit.moveLeft <= 0) unit.moveTargetX = null;
    },

    walkToTarget(unit, dt) {
      if (unit.moveTargetX === null) return;
      const diff = unit.moveTargetX - unit.x;
      if (Math.abs(diff) < 4) {
        unit.moveTargetX = null;
        return;
      }
      this.walkUnit(unit, Math.sign(diff) * WALK_SPEED * dt);
    },

    /* ---------- Physique et résolution ---------- */

    updateUnits(dt) {
      for (const unit of this.units) {
        if (unit.dead) continue;
        unit.flash = Math.max(0, unit.flash - dt);

        if (Math.abs(unit.vx) > 1) {
          unit.x = clamp(unit.x + unit.vx * dt, unit.r + 4, WORLD.width - unit.r - 4);
          unit.vx *= Math.max(0, 1 - 3.6 * dt);
        } else {
          unit.vx = 0;
        }

        unit.vy += GRAVITY * dt;
        unit.y += unit.vy * dt;

        const surface = this.terrain.surfaceY(unit.x);
        if (unit.y + unit.r >= surface) {
          const impact = unit.vy;
          unit.y = surface - unit.r;
          unit.vy = 0;
          if (!unit.onGround && impact > FALL_DAMAGE_SPEED) {
            const damage = Math.round((impact - FALL_DAMAGE_SPEED) / 22);
            if (damage > 0) unit.takeDamage(damage, 'fall');
          }
          unit.onGround = true;
        } else {
          unit.onGround = false;
        }
      }
    },

    updateProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const projectile = this.projectiles[i];
        projectile.update(dt, this.terrain, this.units);
        if (projectile.done) this.projectiles.splice(i, 1);
      }
    },

    updateFlightPhase() {
      if (this.projectiles.length > 0) return;
      this.phase = 'resolve';
      this.resolveTimer = 0.85;
      UI.markDirty();
      UI.refreshAll();
    },

    updateResolvePhase(dt) {
      this.resolveTimer -= dt;
      const falling = this.units.some((u) => !u.dead && !u.onGround);
      if (this.resolveTimer <= 0 && !falling) {
        this.nextTurn();
      } else if (this.resolveTimer < -3) {
        // Garde-fou : on stabilise tout le monde avant de continuer.
        for (const unit of this.units) {
          unit.vx = 0;
          unit.vy = 0;
        }
        this.nextTurn();
      }
    },

    /** Explosion : cratère, dégâts, recul, particules, secousse, son. */
    detonate(x, y, weapon, owner) {
      const removed = this.terrain.carve(x, y, weapon.carve);
      this.damageArea(x, y, weapon.blast, weapon.damage, owner);

      Particles.explosion(x, y, weapon);
      Effects.ring(x, y, weapon.blast * 1.55, weapon.color, 0.55);
      Effects.flash(weapon.id === 'meteor' ? 0.3 : 0.14);
      this.shake = Math.max(this.shake, weapon.id === 'meteor' ? 0.95 : 0.6);
      AudioSys.explosion(weapon.id);
      UI.markDirty();

      if (removed > 0) {
        // Poussière au bord du cratère.
        Particles.burst(x, y + weapon.carve * 0.3, '#e2bf9c', 8, 190, { kind: 'dot', gravity: 900 });
      }
      return removed;
    },

    damageArea(x, y, radius, maxDamage, owner) {
      for (const unit of this.units) {
        if (unit.dead) continue;
        const d = dist(x, y, unit.x, unit.y);
        const reach = radius + unit.r * 0.6;
        if (d > reach) continue;

        const falloff = clamp(1 - d / reach, 0, 1);
        const damage = Math.max(4, Math.round(maxDamage * Math.pow(falloff, 0.75)));
        unit.takeDamage(damage, owner);

        // Recul radial : les unités peuvent être projetées.
        const nx = d > 0.001 ? (unit.x - x) / d : 0;
        const ny = d > 0.001 ? (unit.y - y) / d : -1;
        const force = 380 * falloff;
        unit.vx += nx * force;
        unit.vy += ny * force - 70 * falloff;
        unit.onGround = false;
      }
    },

    /* ---------- Fin de partie ---------- */

    checkVictory() {
      const alivePrism = this.units.filter((u) => u.team === 0 && !u.dead).length;
      const aliveAmber = this.units.filter((u) => u.team === 1 && !u.dead).length;
      if (alivePrism > 0 && aliveAmber > 0) return false;

      const winner = alivePrism > 0 ? 0 : aliveAmber > 0 ? 1 : -1;
      this.endMatch(winner);
      return true;
    },

    endMatch(winnerTeam) {
      if (this.matchOver) return;
      this.matchOver = true;
      this.phase = 'gameover';
      this.ai = null;
      this.activeUnit = null;
      this.projectiles.length = 0;
      UI.markDirty();
      UI.refreshAll();
      UI.showResult(winnerTeam);
      if (winnerTeam >= 0) AudioSys.victory();
    },

    endByPoints() {
      const remaining = (team) => this.units
        .filter((u) => u.team === team && !u.dead)
        .reduce((sum, u) => sum + u.hp, 0);
      const hpPrism = remaining(0);
      const hpAmber = remaining(1);
      const winner = hpPrism > hpAmber ? 0 : hpAmber > hpPrism ? 1 : -1;
      this.endMatch(winner);
    }
  };


  /* ============================================================
     8. RENDU
     Le monde fait 1280 × 720 ; il est mis à l'échelle (letterbox)
     pour occuper l'espace disponible.
     ============================================================ */

  function roundRectPath(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function polygonPath(ctx, sides, radius, rotation = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (i / sides) * TAU;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function starPath(ctx, radius, innerRatio = 0.48) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i / 10) * TAU;
      const r = i % 2 === 0 ? radius : radius * innerRatio;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /** Silhouette géométrique d'une unité. */
  function shapePath(ctx, shape, radius) {
    switch (shape) {
      case 'triangle': polygonPath(ctx, 3, radius * 1.05); break;
      case 'inverted': polygonPath(ctx, 3, radius * 1.05, Math.PI / 2); break;
      case 'diamond': polygonPath(ctx, 4, radius * 1.02); break;
      case 'square': polygonPath(ctx, 4, radius * 0.86, Math.PI / 4); break;
      case 'hexagon': polygonPath(ctx, 6, radius * 0.98); break;
      case 'pentagon': polygonPath(ctx, 5, radius * 1.02); break;
      case 'octagon': polygonPath(ctx, 8, radius * 0.99, Math.PI / 8); break;
      case 'star': starPath(ctx, radius * 1.12); break;
      default:
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TAU);
        ctx.closePath();
    }
  }

  const Renderer = {
    canvas: null,
    ctx: null,
    stage: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    vw: 1,
    vh: 1,
    dpr: 1,
    bg: null,
    clouds: [],
    aimCache: null,

    init() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.stage = document.getElementById('stage');

      this.bg = document.createElement('canvas');
      this.bg.width = WORLD.width;
      this.bg.height = WORLD.height;
      this.buildBackground();

      this.clouds = [
        { x: 150, y: 122, s: 1.0, v: 6 },
        { x: 520, y: 82, s: 0.72, v: 4 },
        { x: 880, y: 148, s: 1.12, v: 8 },
        { x: 1190, y: 64, s: 0.6, v: 3 }
      ];

      this.resize();
      window.addEventListener('resize', () => this.resize());
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.stage);
    },

    resize() {
      const rect = this.stage.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.vw = Math.max(1, rect.width);
      this.vh = Math.max(1, rect.height);
      this.canvas.width = Math.max(1, Math.round(this.vw * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.vh * this.dpr));
      this.scale = Math.min(this.vw / WORLD.width, this.vh / WORLD.height);
      this.offsetX = (this.vw - WORLD.width * this.scale) / 2;
      this.offsetY = (this.vh - WORLD.height * this.scale) / 2;
    },

    /** Convertit des coordonnées écran en coordonnées du monde. */
    toWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.offsetX) / this.scale,
        y: (clientY - rect.top - this.offsetY) / this.scale
      };
    },

    /* ---------- Décor fixe ---------- */

    buildBackground() {
      const ctx = this.bg.getContext('2d');

      const sky = ctx.createLinearGradient(0, 0, 0, 560);
      sky.addColorStop(0, '#cfe8f8');
      sky.addColorStop(0.55, '#e6eef9');
      sky.addColorStop(1, '#fde9db');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);

      // Halo puis soleil plat.
      const halo = ctx.createRadialGradient(1008, 136, 8, 1008, 136, 190);
      halo.addColorStop(0, 'rgba(255, 235, 178, 0.9)');
      halo.addColorStop(1, 'rgba(255, 235, 178, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(760, 0, 520, 380);
      ctx.fillStyle = '#ffe2a0';
      ctx.beginPath();
      ctx.arc(1008, 136, 54, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(992, 120, 19, 0, TAU);
      ctx.fill();

      // Trois crêtes low-poly.
      this.drawRidge(ctx, 522, 96, '#c9d5ef', 13, 3);
      this.drawRidge(ctx, 562, 74, '#b4c3e7', 10, 8);
      this.drawRidge(ctx, 598, 52, '#9eb1da', 8, 15);

      // Brume pastel au pied des reliefs.
      const haze = ctx.createLinearGradient(0, 400, 0, 640);
      haze.addColorStop(0, 'rgba(255, 245, 236, 0)');
      haze.addColorStop(1, 'rgba(255, 245, 236, 0.6)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 360, WORLD.width, 300);
    },

    drawRidge(ctx, baseY, amplitude, color, peaks, seedOffset) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-40, WORLD.height);
      const step = (WORLD.width + 80) / peaks;
      for (let i = 0; i <= peaks; i++) {
        const x = -40 + i * step;
        const noise = hash2(i, seedOffset, 77);
        const y = baseY - amplitude * (0.35 + noise * 0.65) - (i % 2 === 0 ? 0 : amplitude * 0.22);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(WORLD.width + 40, WORLD.height);
      ctx.closePath();
      ctx.fill();
    },

    drawClouds(ctx) {
      for (const cloud of this.clouds) {
        const span = WORLD.width + 300;
        const x = ((cloud.x + Game.time * cloud.v) % span) - 150;
        const y = cloud.y + Math.sin(Game.time * 0.35 + cloud.x) * 4;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.beginPath();
        ctx.ellipse(x, y, 34 * cloud.s, 17 * cloud.s, 0, 0, TAU);
        ctx.ellipse(x + 30 * cloud.s, y + 5 * cloud.s, 26 * cloud.s, 13 * cloud.s, 0, 0, TAU);
        ctx.ellipse(x - 30 * cloud.s, y + 6 * cloud.s, 22 * cloud.s, 11 * cloud.s, 0, 0, TAU);
        ctx.fill();
      }
    },

    /** Fines stries dans le ciel : indice visuel du vent. */
    drawWindStreaks(ctx) {
      const wind = Game.wind;
      if (Math.abs(wind) < 0.12) return;
      const speed = 45 + Math.abs(wind) * 95;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const raw = (Game.time * speed + i * 277) % (WORLD.width + 220);
        const x = wind > 0 ? raw - 110 : WORLD.width - raw + 110;
        const y = 66 + i * 34 + Math.sin(Game.time * 0.7 + i) * 6;
        const len = 24 + i * 6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * Math.sign(wind), y);
        ctx.stroke();
      }
    },

    /* ---------- Composition de la scène ---------- */

    draw() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#223052';
      ctx.fillRect(0, 0, this.vw, this.vh);

      const shake = Game.shake;
      const shakeX = shake > 0 ? rand(-1, 1) * shake * 6 : 0;
      const shakeY = shake > 0 ? rand(-1, 1) * shake * 5 : 0;

      ctx.save();
      ctx.translate(this.offsetX + shakeX, this.offsetY + shakeY);
      ctx.scale(this.scale, this.scale);
      ctx.beginPath();
      ctx.rect(0, 0, WORLD.width, WORLD.height);
      ctx.clip();

      ctx.drawImage(this.bg, 0, 0);
      this.drawClouds(ctx);
      this.drawWindStreaks(ctx);
      ctx.drawImage(Game.terrain.canvas, 0, 0);
      this.drawMoveTarget(ctx);
      this.drawUnits(ctx);
      this.drawProjectiles(ctx);
      this.drawAim(ctx);
      Particles.draw(ctx);
      Effects.draw(ctx);

      ctx.restore();
    },

    drawMoveTarget(ctx) {
      const unit = Game.activeUnit;
      if (!unit || unit.dead || Game.phase !== 'move' || unit.moveTargetX === null) return;

      const x = unit.moveTargetX;
      const y = Game.terrain.surfaceY(x) - 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - 34);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.fill();

      ctx.fillStyle = TEAM_DEFS[unit.team].color;
      ctx.beginPath();
      ctx.moveTo(x, y - 34);
      ctx.lineTo(x + 12, y - 29);
      ctx.lineTo(x, y - 24);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },

    drawUnits(ctx) {
      const units = Game.units.filter((u) => !u.dead).sort((a, b) => a.y - b.y);
      for (const unit of units) this.drawUnit(ctx, unit);
    },

    drawUnit(ctx, unit) {
      const def = TEAM_DEFS[unit.team];
      const active = unit === Game.activeUnit;
      const moving = active && Game.phase === 'move' &&
        (unit.moveTargetX !== null || Game.keys.left || Game.keys.right);
      const bob = moving
        ? Math.sin(unit.walkPhase * 0.18) * 2.2
        : Math.sin(Game.time * 1.8 + unit.index * 1.7) * 1.1;
      const x = unit.x;
      const bodyY = unit.y + bob;
      const surface = Game.terrain.surfaceY(x);

      // Ombre portée au sol.
      ctx.fillStyle = 'rgba(30, 42, 66, 0.18)';
      ctx.beginPath();
      ctx.ellipse(x, surface - 2, unit.r * 0.92, 4.6, 0, 0, TAU);
      ctx.fill();

      // Halo de l'unité active.
      if (active) {
        const pulse = 0.55 + Math.sin(Game.time * 4) * 0.35;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + pulse * 0.3})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, surface - 2, unit.r + 7 + pulse * 3, 8 + pulse * 2, 0, 0, TAU);
        ctx.stroke();
      }

      // Corps géométrique.
      ctx.save();
      ctx.translate(x, bodyY);
      shapePath(ctx, unit.shape, unit.r);
      ctx.fillStyle = unit.flash > 0 ? '#ffffff' : def.color;
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = def.dark;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Facette claire.
      ctx.save();
      shapePath(ctx, unit.shape, unit.r);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
      ctx.beginPath();
      ctx.moveTo(-unit.r, -unit.r);
      ctx.lineTo(unit.r, -unit.r);
      ctx.lineTo(-unit.r, unit.r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Œil orienté vers l'adversaire.
      const eyeX = unit.facing * unit.r * 0.26;
      const eyeY = -unit.r * 0.16;
      ctx.fillStyle = 'rgba(24, 36, 60, 0.85)';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(eyeX + 0.9, eyeY - 0.9, 0.9, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Barre de points de vie.
      const barW = 36;
      const barH = 5;
      const bx = x - barW / 2;
      const by = bodyY - unit.r - 16;
      ctx.fillStyle = 'rgba(28, 40, 64, 0.25)';
      roundRectPath(ctx, bx, by, barW, barH, 3);
      ctx.fill();

      const ratio = clamp(unit.hp / unit.maxHp, 0, 1);
      if (ratio > 0) {
        ctx.fillStyle = ratio > 0.55 ? def.color : ratio > 0.25 ? '#f5c35b' : '#ee6f6b';
        roundRectPath(ctx, bx + 1, by + 1, (barW - 2) * ratio, barH - 2, 2);
        ctx.fill();
      }

      // Étiquette nominative de l'unité active.
      if (active) {
        ctx.font = '800 9px "Trebuchet MS", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(28, 40, 64, 0.72)';
        roundRectPath(ctx, x - 25, by - 18, 50, 13, 6.5);
        ctx.fill();
        ctx.fillStyle = '#fffdf7';
        ctx.fillText(unit.name, x, by - 8);
      }
    },

    drawProjectiles(ctx) {
      for (const projectile of Game.projectiles) {
        if (projectile.trail.length > 1) {
          ctx.strokeStyle = projectile.weapon.color;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(projectile.trail[0].x, projectile.trail[0].y);
          for (let i = 1; i < projectile.trail.length; i++) {
            ctx.lineTo(projectile.trail[i].x, projectile.trail[i].y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        ctx.globalAlpha = 0.25;
        ctx.fillStyle = projectile.weapon.color;
        ctx.beginPath();
        ctx.arc(projectile.x, projectile.y, projectile.radius + 6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.translate(projectile.x, projectile.y);
        ctx.rotate(projectile.rot);
        const radius = projectile.radius;

        if (projectile.weapon.icon === 'square') {
          roundRectPath(ctx, -radius, -radius, radius * 2, radius * 2, 2.5);
          ctx.fillStyle = projectile.weapon.color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = projectile.weapon.dark;
          ctx.stroke();
          ctx.fillStyle = projectile.weapon.dark;
          ctx.fillRect(-2, -2, 4, 4);
        } else if (projectile.weapon.icon === 'diamond') {
          polygonPath(ctx, 4, radius, 0);
          ctx.fillStyle = projectile.weapon.color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = projectile.weapon.dark;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, TAU);
          ctx.fillStyle = projectile.weapon.color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = projectile.weapon.dark;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.beginPath();
          ctx.arc(-2, -2, 2.2, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    },

    /* ---------- Visée ---------- */

    drawAim(ctx) {
      const unit = Game.activeUnit;
      if (!unit || unit.dead || !unit.weapon) return;
      if (Game.phase !== 'aim' && Game.phase !== 'move') return;

      const def = TEAM_DEFS[unit.team];
      const angle = unit.aimAngle;
      const power = unit.aimPower;
      const dirX = Math.cos(angle);
      const dirY = -Math.sin(angle);

      // Ligne de mire courte, visible dans les deux phases.
      ctx.strokeStyle = Game.phase === 'aim' ? def.color : 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(unit.x + dirX * (unit.r + 4), unit.y + dirY * (unit.r + 4));
      ctx.lineTo(unit.x + dirX * (unit.r + 14), unit.y + dirY * (unit.r + 14));
      ctx.stroke();

      if (Game.phase !== 'aim') return;

      // Flèche de puissance.
      const arrowLength = 20 + power * 46;
      const tipX = unit.x + dirX * (unit.r + arrowLength);
      const tipY = unit.y + dirY * (unit.r + arrowLength);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(unit.x + dirX * (unit.r + 2), unit.y + dirY * (unit.r + 2));
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      const perpX = -dirY;
      const perpY = dirX;
      ctx.beginPath();
      ctx.moveTo(tipX + dirX * 6, tipY + dirY * 6);
      ctx.lineTo(tipX + perpX * 5, tipY + perpY * 5);
      ctx.lineTo(tipX - perpX * 5, tipY - perpY * 5);
      ctx.closePath();
      ctx.fill();

      // Étiquette angle / puissance flottant au-dessus de l'unité.
      const label = `${Math.round(toDeg(angle))}° · ${Math.round(power * 100)}%`;
      ctx.font = '800 10px "Trebuchet MS", system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + 16;
      const bx = unit.x - boxW / 2;
      const by = unit.y - unit.r - 38;
      ctx.fillStyle = 'rgba(28, 40, 64, 0.72)';
      roundRectPath(ctx, bx, by, boxW, 17, 8.5);
      ctx.fill();
      ctx.fillStyle = '#fffdf7';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, unit.x, by + 9);
      ctx.textBaseline = 'alphabetic';

      // Trajectoire prévisionnelle pointillée.
      const trajectory = this.getTrajectory(unit);
      for (let i = 0; i < trajectory.points.length; i++) {
        const point = trajectory.points[i];
        const t = i / Math.max(1, trajectory.points.length - 1);
        ctx.globalAlpha = 0.5 * (1 - t) + 0.08;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(point.x, point.y, i % 2 === 0 ? 2.4 : 1.5, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Marqueur du point d'impact prévu.
      if (trajectory.impact) {
        const impact = trajectory.impact;
        ctx.strokeStyle = WEAPONS[unit.weapon].color;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(impact.x, impact.y, 10, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(impact.x - 5, impact.y);
        ctx.lineTo(impact.x + 5, impact.y);
        ctx.moveTo(impact.x, impact.y - 5);
        ctx.lineTo(impact.x, impact.y + 5);
        ctx.stroke();
      }
    },

    /** Simule la trajectoire courante (avec cache pour le rendu). */
    getTrajectory(unit) {
      const key = [
        Math.round(unit.x * 10),
        Math.round(unit.y * 10),
        Math.round(unit.aimAngle * 1000),
        Math.round(unit.aimPower * 1000),
        unit.weapon,
        Math.round(Game.wind * 1000),
        Game.round,
        Game.turnIndex
      ].join('|');

      if (this.aimCache && this.aimCache.key === key) return this.aimCache.value;

      const shot = Game.makeProjectile(unit, unit.weapon, unit.aimAngle, unit.aimPower, true);
      const points = [];
      for (let i = 0; i < 720 && !shot.done; i++) {
        shot.update(1 / 60, Game.terrain, Game.units);
        if (i % 3 === 0) points.push({ x: shot.x, y: shot.y });
      }

      const value = {
        points,
        impact: shot.exploded ? { x: shot.explodeX, y: shot.explodeY } : null
      };
      this.aimCache = { key, value };
      return value;
    }
  };


  /* ============================================================
     9. INTERFACE (HUD, menu, écran de résultat)
     ============================================================ */

  const UI = {
    dom: {},
    dirty: true,
    overlayType: null,
    toastTimer: null,
    readout: { angle: '', power: '', move: '' },
    setup: { unitsPerTeam: 3, aiSkill: 0.82 },

    init() {
      const $ = (id) => document.getElementById(id);
      this.dom = {
        turnBadge: $('turnBadge'),
        roundBadge: $('roundBadge'),
        windArrows: $('windArrows'),
        windValue: $('windValue'),
        rosterA: $('rosterA'),
        rosterB: $('rosterB'),
        teamA: document.querySelector('.team--a'),
        teamB: document.querySelector('.team--b'),
        teamAHealth: $('teamAHealth'),
        teamBHealth: $('teamBHealth'),
        phasePill: $('phasePill'),
        hint: $('hint'),
        weapons: $('weapons'),
        angleValue: $('angleValue'),
        powerValue: $('powerValue'),
        moveValue: $('moveValue'),
        actionBtn: $('actionBtn'),
        skipBtn: $('skipBtn'),
        queue: $('turnQueue'),
        toast: $('toast'),
        overlay: $('overlay'),
        overlayCard: $('overlayCard'),
        soundBtn: $('soundBtn'),
        menuBtn: $('menuBtn'),
        canvas: $('game')
      };
      this.bind();
    },

    bind() {
      this.dom.weapons.addEventListener('click', (event) => {
        const button = event.target.closest('[data-weapon]');
        if (!button || button.disabled) return;
        Game.selectWeapon(button.dataset.weapon);
      });

      this.dom.actionBtn.addEventListener('click', () => {
        if (Game.phase === 'move') {
          Game.confirmMove();
        } else if (Game.phase === 'aim' && Game.activeUnit && Game.activeUnit.team === 0) {
          Game.fire(Game.activeUnit.aimAngle, Game.activeUnit.aimPower);
        }
      });

      this.dom.skipBtn.addEventListener('click', () => Game.endTurn());

      this.dom.soundBtn.addEventListener('click', () => {
        AudioSys.ensure();
        AudioSys.setMuted(!AudioSys.muted);
        this.refreshSound();
        AudioSys.ui();
      });

      this.dom.menuBtn.addEventListener('click', () => {
        AudioSys.ensure();
        AudioSys.ui();
        if (!this.overlayType) this.showSetup();
      });

      this.dom.overlayCard.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        if (button.dataset.units) {
          this.setup.unitsPerTeam = Number(button.dataset.units);
          this.dom.overlayCard.querySelectorAll('[data-units]').forEach((b) => {
            b.classList.toggle('is-on', b === button);
          });
          AudioSys.ui();
          return;
        }

        if (button.dataset.skill) {
          this.setup.aiSkill = Number(button.dataset.skill);
          this.dom.overlayCard.querySelectorAll('[data-skill]').forEach((b) => {
            b.classList.toggle('is-on', b === button);
          });
          AudioSys.ui();
          return;
        }

        const action = button.dataset.action;
        if (action === 'start') {
          AudioSys.ensure();
          Game.startMatch({ unitsPerTeam: this.setup.unitsPerTeam, aiSkill: this.setup.aiSkill });
        } else if (action === 'replay') {
          AudioSys.ensure();
          Game.startMatch(Game.config);
        } else if (action === 'resume') {
          this.hideOverlay();
        } else if (action === 'setup') {
          this.showSetup();
        }
        AudioSys.ui();
      });
    },

    controlsHtml() {
      return `
        <div class="controls-grid">
          <div><kbd>←</kbd><kbd>→</kbd> ou clic sur le sol : marcher</div>
          <div><kbd>Espace</kbd> : valider la position</div>
          <div><kbd>Souris</kbd> : viser, relâcher pour tirer</div>
          <div><kbd>↑</kbd><kbd>↓</kbd> angle · <kbd>←</kbd><kbd>→</kbd> puissance</div>
          <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> : changer d'arme</div>
          <div><kbd>M</kbd> : son · <kbd>Échap</kbd> : menu</div>
        </div>`;
    },

    refreshSound() {
      this.dom.soundBtn.classList.toggle('is-muted', AudioSys.muted);
      this.dom.soundBtn.setAttribute('aria-pressed', AudioSys.muted ? 'false' : 'true');
      this.dom.soundBtn.title = AudioSys.muted ? 'Activer le son (M)' : 'Couper le son (M)';
    },

    /* ---------- Calques ---------- */

    showSetup() {
      const inProgress = Game.units.length > 0 && !Game.matchOver;
      this.overlayType = 'setup';
      const unitButton = (n) => `<button type="button" data-units="${n}" class="${this.setup.unitsPerTeam === n ? 'is-on' : ''}">${n}</button>`;
      const skillButton = (value, label) => `<button type="button" data-skill="${value}" class="${this.setup.aiSkill === value ? 'is-on' : ''}">${label}</button>`;

      this.dom.overlayCard.innerHTML = `
        <p class="eyebrow">Jeu original · HTML5 Canvas</p>
        <h1 class="logo">PRISME</h1>
        <p class="lead">Deux équipes de formes pastel, un terrain qui s'effondre et du vent à lire.
        Déplacez une unité, ajustez votre tir, choisissez la bonne arme : la dernière équipe avec
        une unité vivante remporte le duel.</p>

        <div class="setup">
          <div class="setup__block">
            <span class="setup__label">Unités par équipe</span>
            <div class="segmented">${unitButton(2)}${unitButton(3)}${unitButton(4)}</div>
          </div>
          <div class="setup__block">
            <span class="setup__label">Intelligence adverse</span>
            <div class="segmented">
              ${skillButton(0.5, 'Amicale')}
              ${skillButton(0.82, 'Rusée')}
            </div>
          </div>
        </div>

        <button class="cta" type="button" data-action="start">Lancer la partie</button>
        ${inProgress ? '<button class="ghost-wide" type="button" data-action="resume">Reprendre la partie en cours</button>' : ''}
        ${this.controlsHtml()}
      `;

      this.dom.overlay.classList.add('is-open');
      Game.paused = true;
      this.refreshSound();
    },

    showResult(winner) {
      this.overlayType = 'result';
      const def = winner >= 0 ? TEAM_DEFS[winner] : null;
      const title = def ? `Victoire de ${def.name}` : 'Match nul';
      const color = def ? def.dark : '#5f6f8a';

      const stats = (team) => {
        const list = Game.units.filter((u) => u.team === team);
        return {
          survivors: list.filter((u) => !u.dead),
          hp: list.reduce((sum, u) => sum + Math.max(0, u.hp), 0)
        };
      };

      const scoreCard = (team) => {
        const teamDef = TEAM_DEFS[team];
        const state = stats(team);
        const isWinner = winner === team;
        const members = state.survivors.length
          ? state.survivors.map((u) => `${u.name} — ${u.hp} PV`).join(' · ')
          : 'Aucune unité debout';
        return `
          <div class="score-card ${isWinner ? 'is-winner' : ''}"
               style="--team:${teamDef.color};--team-dark:${teamDef.dark}">
            <div class="score-card__name">
              <span>${teamDef.name}</span>
              <span class="score-card__hp">${state.hp} PV</span>
            </div>
            <div class="score-card__units">${members}</div>
            <span class="score-card__tag">${isWinner ? 'Vainqueur' : winner === -1 ? 'Égalité' : 'Éliminée'}</span>
          </div>`;
      };

      this.dom.overlayCard.innerHTML = `
        <p class="eyebrow">Fin de la partie · manche ${Game.round}</p>
        <h2 class="result-title" style="--win:${color}">${title}</h2>
        <p class="result-sub">${def
          ? `${def.name} garde au moins une unité en vie. Le terrain, lui, s'en souviendra.`
          : 'La limite de manches est atteinte : les deux équipes restent à égalité.'}</p>
        <div class="scoreboard">${scoreCard(0)}${scoreCard(1)}</div>
        <button class="cta" type="button" data-action="replay">Rejouer</button>
        <button class="ghost-wide" type="button" data-action="setup">Changer la configuration</button>
      `;

      this.dom.overlay.classList.add('is-open');
      Game.paused = true;
    },

    hideOverlay() {
      this.dom.overlay.classList.remove('is-open');
      this.overlayType = null;
      Game.paused = false;
    },

    /* ---------- Rafraîchissements du HUD ---------- */

    markDirty() { this.dirty = true; },

    refreshAll() {
      this.refreshHeader();
      this.refreshRosters();
      this.refreshWeapons();
      this.refreshPhase();
      this.refreshQueue();
      this.readout = { angle: '', power: '', move: '' };
      this.tick(true);
      this.dirty = false;
    },

    refreshHeader() {
      const unit = Game.activeUnit;
      const { turnBadge, roundBadge, windArrows, windValue, teamA, teamB, teamAHealth, teamBHealth } = this.dom;

      if (unit) {
        turnBadge.textContent = TEAM_DEFS[unit.team].name;
        turnBadge.classList.toggle('is-amber', unit.team === 1);
        teamA.classList.toggle('is-active', unit.team === 0);
        teamB.classList.toggle('is-active', unit.team === 1);
      } else {
        turnBadge.textContent = 'Prisme';
        turnBadge.classList.remove('is-amber');
        teamA.classList.remove('is-active');
        teamB.classList.remove('is-active');
      }

      roundBadge.textContent = `Manche ${Game.round}`;

      const wind = Game.wind;
      const strength = Math.abs(wind);
      windValue.textContent = (strength * 10).toFixed(1);
      if (strength < 0.05) {
        windArrows.textContent = '—';
      } else {
        const count = clamp(Math.ceil(strength * 3), 1, 3);
        windArrows.textContent = (wind > 0 ? '▶' : '◀').repeat(count);
      }

      const teamPercent = (team) => {
        const list = Game.units.filter((u) => u.team === team);
        if (!list.length) return 0;
        const current = list.reduce((sum, u) => sum + Math.max(0, u.hp), 0);
        const total = list.reduce((sum, u) => sum + u.maxHp, 0);
        return Math.round((current / total) * 100);
      };
      teamAHealth.textContent = `${teamPercent(0)}%`;
      teamBHealth.textContent = `${teamPercent(1)}%`;
    },

    refreshRosters() {
      const chips = (team) => Game.units
        .filter((u) => u.team === team)
        .map((u) => `
          <div class="chip ${u === Game.activeUnit ? 'is-active' : ''} ${u.dead ? 'is-dead' : ''}"
               style="--team:${TEAM_DEFS[team].color}">
            <span class="chip__name">${u.name}</span>
            <span class="chip__hp">${u.dead ? 'K.O.' : `${u.hp} PV`}</span>
            <span class="chip__bar"><i style="width:${clamp(u.hp, 0, 100)}%"></i></span>
          </div>`)
        .join('');
      this.dom.rosterA.innerHTML = chips(0);
      this.dom.rosterB.innerHTML = chips(1);
    },

    refreshWeapons() {
      const unit = Game.activeUnit;
      if (!unit) {
        this.dom.weapons.innerHTML = '';
        return;
      }

      const canUse = unit.team === 0 && (Game.phase === 'aim' || Game.phase === 'move');
      this.dom.weapons.innerHTML = WEAPON_ORDER.map((id) => {
        const weapon = WEAPONS[id];
        const ammo = unit.ammo[id];
        const dots = Array.from({ length: weapon.ammo }, (_, i) =>
          `<i class="${i < ammo ? '' : 'is-empty'}"></i>`).join('');
        const selected = unit.weapon === id ? 'is-selected' : '';
        return `
          <button type="button" class="weapon ${selected}" data-weapon="${id}"
                  style="--wc:${weapon.color};--wc-dark:${weapon.dark}"
                  title="${weapon.name} — ${ammo} munition(s) — dégâts ${weapon.damage}"
                  ${ammo <= 0 || !canUse ? 'disabled' : ''}>
            <span class="weapon__icon weapon__icon--${weapon.icon}"></span>
            <span class="weapon__body">
              <span class="weapon__name">${weapon.name}</span>
              <span class="weapon__ammo">${dots}</span>
            </span>
          </button>`;
      }).join('');
    },

    refreshPhase() {
      const unit = Game.activeUnit;
      const phase = Game.phase;
      let label = 'Prêt';
      let phaseClass = '';
      let hint = 'Choisissez une configuration pour commencer.';
      let actionLabel = 'Valider la position';
      let actionEnabled = false;
      let skipEnabled = false;
      const isPlayer = Boolean(unit && unit.team === 0 && !unit.dead);

      if (phase === 'move') {
        label = 'Déplacement';
        phaseClass = 'is-move';
        if (isPlayer) {
          hint = '← → ou clic sur le sol pour marcher · Espace pour valider';
          actionLabel = 'Valider la position';
          actionEnabled = true;
          skipEnabled = true;
        } else if (unit) {
          hint = 'L\'IA se déplace…';
        }
      } else if (phase === 'aim') {
        label = 'Visée';
        phaseClass = 'is-aim';
        if (isPlayer) {
          hint = 'Souris : viser puis relâcher · ↑↓ angle · ←→ puissance · 1-3 armes';
          actionLabel = 'Tirer';
          actionEnabled = Boolean(unit.weapon && unit.ammo[unit.weapon] > 0);
          skipEnabled = true;
        } else if (unit) {
          hint = 'L\'IA ajuste son tir…';
        }
      } else if (phase === 'flight') {
        label = 'Tir en vol';
        phaseClass = 'is-flight';
        hint = 'Le projectile suit sa course…';
      } else if (phase === 'resolve') {
        label = 'Résolution';
        phaseClass = 'is-resolve';
        hint = 'Le terrain se stabilise…';
      } else if (phase === 'gameover') {
        label = 'Partie terminée';
        phaseClass = 'is-over';
        hint = 'Rejouez pour prendre votre revanche.';
      }

      this.dom.phasePill.textContent = label;
      this.dom.phasePill.className = `phase ${phaseClass}`;
      this.dom.hint.textContent = hint;
      this.dom.actionBtn.textContent = actionLabel;
      this.dom.actionBtn.disabled = !actionEnabled;
      this.dom.actionBtn.classList.toggle('is-amber', Boolean(unit && unit.team === 1));
      this.dom.skipBtn.disabled = !skipEnabled;
      this.dom.canvas.classList.toggle('is-idle', !(isPlayer && (phase === 'move' || phase === 'aim')));
    },

    refreshQueue() {
      if (!Game.turnOrder.length) {
        this.dom.queue.innerHTML = '';
        return;
      }
      const items = Game.turnOrder.map((unit, index) => {
        const state = index === Game.turnIndex ? 'is-current' : index < Game.turnIndex ? 'is-past' : '';
        return `<span class="queue__item ${state}" style="--team:${TEAM_DEFS[unit.team].color}">${unit.name}</span>`;
      }).join('');
      this.dom.queue.innerHTML = `<span class="queue__label">Ordre</span>${items}`;
    },

    tick(force = false) {
      // `refreshAll()` termine par `tick(true)` : sans ce garde-fou, les deux
      // méthodes s'appellent mutuellement à l'infini (stack overflow au boot).
      if (this.dirty && !force) this.refreshAll();
      const unit = Game.activeUnit;
      if (!unit) return;

      const angle = `${Math.round(toDeg(unit.aimAngle))}°`;
      const power = `${Math.round(unit.aimPower * 100)}%`;
      const move = `${Math.round(unit.moveLeft)} px`;

      if (force || this.readout.angle !== angle) {
        this.dom.angleValue.textContent = angle;
        this.readout.angle = angle;
      }
      if (force || this.readout.power !== power) {
        this.dom.powerValue.textContent = power;
        this.readout.power = power;
      }
      if (force || this.readout.move !== move) {
        this.dom.moveValue.textContent = move;
        this.readout.move = move;
      }
    },

    toast(message, duration = 2200) {
      this.dom.toast.textContent = message;
      this.dom.toast.classList.add('is-visible');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.dom.toast.classList.remove('is-visible');
      }, duration);
    }
  };


  /* ============================================================
     10. ENTRÉES CLAVIER / SOURIS ET DÉMARRAGE
     ============================================================ */

  const Input = {
    init() {
      const canvas = Renderer.canvas;
      canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
      canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
      canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
      canvas.addEventListener('pointercancel', () => { Game.dragging = false; });
      canvas.addEventListener('pointerleave', () => {
        Game.mouse.inside = false;
        Game.dragging = false;
      });
      canvas.addEventListener('contextmenu', (event) => event.preventDefault());
      window.addEventListener('keydown', (event) => this.onKeyDown(event));
      window.addEventListener('keyup', (event) => this.onKeyUp(event));
      window.addEventListener('blur', () => this.releaseKeys());
    },

    releaseKeys() {
      Game.keys.left = false;
      Game.keys.right = false;
      Game.keys.up = false;
      Game.keys.down = false;
    },

    /** Traduit la position du pointeur en angle et en puissance. */
    aimFromPoint(x, y) {
      const unit = Game.activeUnit;
      if (!unit) return;

      let angle = Math.atan2(unit.y - y, x - unit.x);
      if (angle < 0) angle = x > unit.x ? toRad(2.5) : toRad(177.5);
      unit.aimAngle = clamp(angle, toRad(2.5), toRad(177.5));
      unit.aimPower = clamp(Math.hypot(x - unit.x, y - unit.y) / (WORLD.width * 0.3), 0.06, 1);
    },

    onPointerMove(event) {
      const point = Renderer.toWorld(event.clientX, event.clientY);
      Game.mouse.x = point.x;
      Game.mouse.y = point.y;
      Game.mouse.inside = true;

      if (Game.paused) return;
      if (Game.phase === 'aim' && Game.activeUnit && Game.activeUnit.team === 0) {
        this.aimFromPoint(point.x, point.y);
      }
    },

    onPointerDown(event) {
      AudioSys.ensure();
      if (Game.paused || UI.overlayType) return;

      const point = Renderer.toWorld(event.clientX, event.clientY);
      const unit = Game.activeUnit;
      if (!unit || unit.dead || unit.team !== 0) return;

      try {
        Renderer.canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Certains navigateurs refusent la capture : sans gravité.
      }

      if (Game.phase === 'move') {
        unit.moveTargetX = clamp(point.x, unit.r + 6, WORLD.width - unit.r - 6);
        return;
      }

      if (Game.phase === 'aim') {
        this.aimFromPoint(point.x, point.y);
        Game.dragging = true;
        event.preventDefault();
      }
    },

    onPointerUp(event) {
      if (!Game.dragging) return;
      Game.dragging = false;
      if (Game.paused || UI.overlayType) return;

      const unit = Game.activeUnit;
      if (!unit || unit.team !== 0 || Game.phase !== 'aim') return;
      if (Game.aimCooldown > 0) return;

      const point = Renderer.toWorld(event.clientX, event.clientY);
      this.aimFromPoint(point.x, point.y);
      Game.fire(unit.aimAngle, unit.aimPower);
    },

    toggleSound() {
      AudioSys.ensure();
      AudioSys.setMuted(!AudioSys.muted);
      UI.refreshSound();
      AudioSys.ui();
    },

    onKeyDown(event) {
      AudioSys.ensure();
      const key = event.key;
      const lower = key.toLowerCase();

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) {
        event.preventDefault();
      }

      if (lower === 'm') {
        this.toggleSound();
        return;
      }

      // Un calque est ouvert : Entrée valide, Échap reprend.
      if (UI.overlayType) {
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          const button = UI.dom.overlayCard.querySelector('[data-action="start"], [data-action="replay"]');
          if (button) button.click();
        } else if (key === 'Escape' && UI.overlayType === 'setup' && Game.units.length && !Game.matchOver) {
          UI.hideOverlay();
        }
        return;
      }

      // Marche (flèches, ZQSD ou WASD).
      if (key === 'ArrowLeft' || lower === 'a' || lower === 'q') Game.keys.left = true;
      if (key === 'ArrowRight' || lower === 'd') Game.keys.right = true;
      if (key === 'ArrowUp' || lower === 'w' || lower === 'z') Game.keys.up = true;
      if (key === 'ArrowDown' || lower === 's') Game.keys.down = true;
      if (event.repeat) return;

      if (key === ' ' || key === 'Enter') {
        if (Game.phase === 'move') {
          Game.confirmMove();
        } else if (Game.phase === 'aim' && Game.activeUnit && Game.activeUnit.team === 0) {
          Game.fire(Game.activeUnit.aimAngle, Game.activeUnit.aimPower);
        }
      }

      if (Game.phase === 'aim' && Game.activeUnit && Game.activeUnit.team === 0) {
        if (key === '1' || key === '2' || key === '3') {
          Game.selectWeapon(WEAPON_ORDER[Number(key) - 1]);
        }
        if (lower === 'e') Game.endTurn();
      }

      if (key === 'Escape' && Game.units.length && !Game.matchOver) {
        UI.showSetup();
      }
    },

    onKeyUp(event) {
      const key = event.key;
      const lower = key.toLowerCase();
      if (key === 'ArrowLeft' || lower === 'a' || lower === 'q') Game.keys.left = false;
      if (key === 'ArrowRight' || lower === 'd') Game.keys.right = false;
      if (key === 'ArrowUp' || lower === 'w' || lower === 'z') Game.keys.up = false;
      if (key === 'ArrowDown' || lower === 's') Game.keys.down = false;
    }
  };

  /* ---------- Démarrage ---------- */

  UI.init();
  Renderer.init();
  Input.init();

  // Décor d'arrière-plan du menu (le terrain est régénéré à chaque partie).
  Game.terrain.generate(randInt(1, 999999));
  UI.showSetup();
  UI.refreshAll();
  UI.refreshSound();

  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastFrame) / 1000, 1 / 20);
    lastFrame = now;
    Game.update(dt);
    Renderer.draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Point d'entrée public : débogage, tests et extensions.
  window.PrismeGame = { Game, AI, WEAPONS, TEAM_DEFS, UI, Renderer, Particles, Effects, AudioSys };
})();

