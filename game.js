(() => {
  'use strict';

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let cssWidth = 0, cssHeight = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const minimapCanvas = document.getElementById('minimap');
  const minimapCtx = minimapCanvas.getContext('2d');
  minimapCanvas.width = 240;
  minimapCanvas.height = 240;
  minimapCtx.scale(2, 2);

  // ---------- World constants ----------
  const WORLD_SIZE = 3200;
  const BASE_X = WORLD_SIZE / 2;
  const BASE_Y = WORLD_SIZE / 2;
  const DEPOT_RADIUS = 70;
  const CHOP_RANGE = 78;
  const CHOP_RATE = 32; // tree hp per second
  const TREE_MAX_HP = 60;
  const TREE_CANOPY_RADIUS = 27;
  const WOOD_PRICE = 5;
  const SELL_RATE = 4; // logs per second when at depot
  const PLAYER_SPEED = 210;
  const PLAYER_MAX_HP = 100;
  const BEAR_AGGRO_RANGE = 160;
  const BEAR_ATTACK_RANGE = 34;
  const BEAR_DAMAGE = 9;
  const BEAR_MAX_HP = 60;
  const PLAYER_ATTACK_RANGE = 70;
  const PLAYER_ATTACK_DPS = 26;
  const TOWER_RADIUS = 170;
  const TOWER_DPS = 22;
  const WORKER_SPEED = 140;
  const WORKER_CHOP_RATE = 18; // slower than the player
  const WORKER_CAPACITY = 3;
  const WORKER_ARRIVE_RANGE = 30;
  const STOCKPILE_CAP = 300;
  const HUNTER_SPEED = 155;
  const HUNTER_ATTACK_RANGE = 32;
  const HUNTER_DPS = 30;
  const HUNTER_PATROL_RADIUS = 170;
  const MINIMAP_SIZE = 120;
  const MINIMAP_WORLD_RADIUS = 900;
  const BASE_SELL_RATE = 0.5; // logs/s always converted to coins, even with no Vendeur
  const PLAYER_RADIUS = 16;
  const BEAR_RADIUS = 16;
  const NPC_RADIUS = 12;
  const WALL_RADIUS = 20;
  const WALL_MIN_SEPARATION = 32;
  const POPUP_LIFETIME = 900;
  const SHAKE_DURATION = 250;
  const GOLDEN_TREE_CHANCE = 0.05;
  const BEAR_BONUS_CHANCE = 0.15;
  const CHEST_PICKUP_RADIUS = 36;
  const CHEST_MIN_INTERVAL = 90000;
  const CHEST_MAX_INTERVAL = 180000;

  function spawnPopup(x, y, text, color) {
    state.popups.push({ x, y, text, color, createdAt: performance.now() });
  }

  function spawnParticles(x, y, count, colors) {
    for (let i = 0; i < count; i++) {
      const angle = randRange(0, Math.PI * 2);
      const speed = randRange(40, 120);
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: randRange(3, 6),
        createdAt: performance.now(),
        life: randRange(400, 700),
      });
    }
  }

  let shakeUntil = 0;
  let shakeMagnitude = 0;
  function triggerShake(magnitude) {
    shakeUntil = performance.now() + SHAKE_DURATION;
    shakeMagnitude = magnitude;
  }

  // ---------- Sound & haptics ----------
  let audioCtx = null;
  function unlockAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  function beep(freq, duration, type, volume) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  const sfx = {
    harvest() { beep(660, 0.12, 'triangle', 0.12); vibrate(15); },
    coin() { beep(880, 0.08, 'square', 0.06); },
    hit() { beep(120, 0.15, 'sawtooth', 0.18); vibrate(40); },
    death() { beep(90, 0.5, 'sawtooth', 0.2); vibrate([50, 50, 50]); },
    revive() { beep(520, 0.25, 'sine', 0.15); vibrate(20); },
    bearDown() { beep(740, 0.15, 'triangle', 0.12); },
    bonus() { beep(700, 0.09, 'square', 0.1); setTimeout(() => beep(1050, 0.14, 'square', 0.1), 90); },
  };

  const COSTS = {
    lumberjack: { base: 20, growth: 1.15 },
    seller: { base: 30, growth: 1.15 },
    hunter: { base: 60, growth: 1.2 },
    tower: { base: 90, growth: 1.25 },
    territory: { base: 120, growth: 1.4 },
    wall: { base: 15, growth: 1.08 },
    door: { base: 25, growth: 1.1 },
  };

  function costOf(kind, count) {
    const c = COSTS[kind];
    return Math.round(c.base * Math.pow(c.growth, count));
  }

  // ---------- State ----------
  const state = {
    coins: 0,
    stockpile: 0,
    lumberjacks: 0,
    sellers: 0,
    hunters: 0,
    territoryLevel: 0,
    towers: [],
    walls: [],
    doors: [],
    player: {
      x: BASE_X, y: BASE_Y - 40,
      hp: PLAYER_MAX_HP,
      wood: 0,
      woodCapacity: 10,
      lastHitAt: -999,
      invulnerableUntil: 0,
      facing: 0,
    },
    trees: [],
    bears: [],
    workers: [],
    hunterUnits: [],
    chopTarget: null,
    attacking: false,
    attackTarget: null,
    placementMode: null, // null | 'tower' | 'wall' | 'door'
    dead: false,
    popups: [],
    particles: [],
    chests: [],
    stats: { treesChopped: 0, bearsKilled: 0 },
    unlockedAchievements: [],
  };

  const ACHIEVEMENTS = [
    { id: 'tree10', title: 'Bûcheron débutant', desc: 'Couper 10 arbres', reward: 20, check: () => state.stats.treesChopped >= 10 },
    { id: 'tree100', title: 'Bûcheron chevronné', desc: 'Couper 100 arbres', reward: 60, check: () => state.stats.treesChopped >= 100 },
    { id: 'tree500', title: 'Maître bûcheron', desc: 'Couper 500 arbres', reward: 150, check: () => state.stats.treesChopped >= 500 },
    { id: 'bear5', title: "Chasseur d'ours", desc: 'Tuer 5 ours', reward: 30, check: () => state.stats.bearsKilled >= 5 },
    { id: 'bear25', title: 'Terreur des bois', desc: 'Tuer 25 ours', reward: 90, check: () => state.stats.bearsKilled >= 25 },
    { id: 'bear100', title: 'Légende de la forêt', desc: 'Tuer 100 ours', reward: 200, check: () => state.stats.bearsKilled >= 100 },
    { id: 'territory3', title: 'Petit empire', desc: 'Agrandir le territoire 3 fois', reward: 80, check: () => state.territoryLevel >= 3 },
    { id: 'territory8', title: 'Grand empire', desc: 'Agrandir le territoire 8 fois', reward: 250, check: () => state.territoryLevel >= 8 },
    { id: 'coins1000', title: 'Économe', desc: 'Avoir 1000 pièces en poche', reward: 50, check: () => state.coins >= 1000 },
    { id: 'coins10000', title: 'Fortune', desc: 'Avoir 10000 pièces en poche', reward: 300, check: () => state.coins >= 10000 },
    { id: 'lumberjack10', title: 'Petite entreprise', desc: 'Employer 10 bûcherons', reward: 100, check: () => state.lumberjacks >= 10 },
    { id: 'hunter10', title: 'Milice', desc: 'Employer 10 chasseurs', reward: 100, check: () => state.hunters >= 10 },
    { id: 'wall20', title: 'Forteresse', desc: 'Construire 20 murs', reward: 80, check: () => state.walls.length >= 20 },
  ];

  function checkAchievements() {
    let unlockedThisFrame = 0;
    for (const ach of ACHIEVEMENTS) {
      if (state.unlockedAchievements.includes(ach.id)) continue;
      if (ach.check()) {
        state.unlockedAchievements.push(ach.id);
        state.coins += ach.reward;
        sfx.bonus();
        spawnPopup(state.player.x, state.player.y - 50 - unlockedThisFrame * 24, `🏆 ${ach.title} ! +${ach.reward} 🪙`, '#ffd166');
        unlockedThisFrame++;
      }
    }
  }

  let nextChestAt = 0;

  function territoryRadius() {
    return 300 + state.territoryLevel * 150;
  }

  function maxTrees() {
    return 40 + state.territoryLevel * 8;
  }

  function targetBearCount() {
    return Math.min(6 + state.territoryLevel * 2, 20);
  }

  function reviveCost() {
    return Math.round(40 + state.territoryLevel * 25);
  }

  function hunterDamageReduction() {
    return Math.min(0.5, state.hunters * 0.05);
  }

  // ---------- Persistence ----------
  let offlineEarnings = null;

  const OFFLINE_CAP_SECONDS = 4 * 3600; // being away longer than this doesn't earn more
  const OFFLINE_EFFICIENCY = 0.2; // workers are much slower without supervision

  function simulateOfflineEarnings(elapsedSeconds) {
    const capped = Math.min(elapsedSeconds, OFFLINE_CAP_SECONDS);
    if (capped < 20) return null;
    const lumberRate = state.lumberjacks * 0.3 * OFFLINE_EFFICIENCY;
    const sellRate = (BASE_SELL_RATE + state.sellers * 1.0) * OFFLINE_EFFICIENCY;
    let remaining = capped;
    let logsSold = 0;
    let coinsEarned = 0;
    while (remaining > 0) {
      const step = Math.min(60, remaining);
      remaining -= step;
      state.stockpile = Math.min(STOCKPILE_CAP, state.stockpile + lumberRate * step);
      if (state.stockpile > 0) {
        const sold = Math.min(state.stockpile, sellRate * step);
        state.stockpile -= sold;
        logsSold += sold;
        state.coins += sold * WOOD_PRICE;
        coinsEarned += sold * WOOD_PRICE;
      }
    }
    if (coinsEarned < 1) return null;
    return { seconds: capped, logsSold: Math.round(logsSold), coinsEarned: Math.round(coinsEarned) };
  }

  function save() {
    const data = {
      coins: state.coins,
      stockpile: state.stockpile,
      lumberjacks: state.lumberjacks,
      sellers: state.sellers,
      hunters: state.hunters,
      territoryLevel: state.territoryLevel,
      towers: state.towers,
      walls: state.walls,
      doors: state.doors,
      stats: state.stats,
      unlockedAchievements: state.unlockedAchievements,
      lastSaveAt: Date.now(),
    };
    localStorage.setItem('lumberjackSave', JSON.stringify(data));
  }

  function load() {
    try {
      const raw = localStorage.getItem('lumberjackSave');
      if (!raw) return;
      const data = JSON.parse(raw);
      state.coins = data.coins || 0;
      state.stockpile = data.stockpile || 0;
      state.lumberjacks = data.lumberjacks || 0;
      state.sellers = data.sellers || 0;
      state.hunters = data.hunters || 0;
      state.territoryLevel = data.territoryLevel || 0;
      state.towers = Array.isArray(data.towers) ? data.towers : [];
      state.walls = Array.isArray(data.walls) ? data.walls : [];
      state.doors = Array.isArray(data.doors) ? data.doors : [];
      state.stats = data.stats && typeof data.stats === 'object'
        ? { treesChopped: data.stats.treesChopped || 0, bearsKilled: data.stats.bearsKilled || 0 }
        : { treesChopped: 0, bearsKilled: 0 };
      state.unlockedAchievements = Array.isArray(data.unlockedAchievements) ? data.unlockedAchievements : [];
      if (data.lastSaveAt) {
        const elapsedSeconds = (Date.now() - data.lastSaveAt) / 1000;
        offlineEarnings = simulateOfflineEarnings(elapsedSeconds);
      }
    } catch (e) { /* ignore corrupt save */ }
  }

  // ---------- World generation ----------
  function randRange(a, b) { return a + Math.random() * (b - a); }

  function randomWorldPos(minDistFromBase) {
    let x, y;
    do {
      x = randRange(80, WORLD_SIZE - 80);
      y = randRange(80, WORLD_SIZE - 80);
    } while (Math.hypot(x - BASE_X, y - BASE_Y) < minDistFromBase);
    return { x, y };
  }

  // Pushes entity out of any obstacle it overlaps (walls block everyone, doors block only bears)
  function resolveWallCollision(entity, entityRadius, blockedByDoors) {
    const obstacles = blockedByDoors ? state.walls.concat(state.doors) : state.walls;
    for (const o of obstacles) {
      const dx = entity.x - o.x, dy = entity.y - o.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const minDist = entityRadius + WALL_RADIUS;
      if (dist < minDist) {
        entity.x = o.x + (dx / dist) * minDist;
        entity.y = o.y + (dy / dist) * minDist;
      }
    }
  }

  function spawnTree() {
    const pos = randomWorldPos(120);
    state.trees.push({
      x: pos.x, y: pos.y, hp: TREE_MAX_HP, alive: true, respawnAt: 0,
      golden: Math.random() < GOLDEN_TREE_CHANCE,
    });
  }

  function bearKillReward(x, y) {
    state.stats.bearsKilled++;
    let coins = 2;
    let bonus = false;
    if (Math.random() < BEAR_BONUS_CHANCE) {
      coins += Math.round(randRange(10, 25));
      bonus = true;
    }
    state.coins += coins;
    if (bonus) {
      spawnPopup(x, y - 20, `+${coins} 🪙 Bonus !`, '#ffd166');
      sfx.bonus();
    } else {
      spawnPopup(x, y - 20, '+2 🪙', '#ffcf5c');
    }
  }

  function maybeSpawnChest(now) {
    if (state.chests.length > 0 || now < nextChestAt) return;
    const angle = randRange(0, Math.PI * 2);
    const dist = randRange(150, Math.max(200, territoryRadius()));
    state.chests.push({ x: BASE_X + Math.cos(angle) * dist, y: BASE_Y + Math.sin(angle) * dist });
    nextChestAt = now + randRange(CHEST_MIN_INTERVAL, CHEST_MAX_INTERVAL);
  }

  function spawnBear() {
    const pos = randomWorldPos(territoryRadius() + 150);
    state.bears.push({
      x: pos.x, y: pos.y, hp: BEAR_MAX_HP,
      dirX: 0, dirY: 0, changeDirAt: 0, alive: true, respawnAt: 0,
    });
  }

  function spawnWorker() {
    const angle = randRange(0, Math.PI * 2);
    const dist = randRange(20, 50);
    state.workers.push({
      x: BASE_X + Math.cos(angle) * dist,
      y: BASE_Y + Math.sin(angle) * dist,
      state: 'toTree',
      targetTree: null,
      wood: 0,
    });
  }

  function spawnHunterUnit() {
    const angle = randRange(0, Math.PI * 2);
    const dist = randRange(20, 50);
    state.hunterUnits.push({
      x: BASE_X + Math.cos(angle) * dist,
      y: BASE_Y + Math.sin(angle) * dist,
      state: 'patrol',
      targetBear: null,
      patrolAngle: angle,
      patrolChangeAt: 0,
    });
  }

  function ensurePopulation() {
    while (state.trees.filter(t => t.alive).length < maxTrees() && state.trees.length < maxTrees() + 5) {
      spawnTree();
    }
    while (state.bears.length < targetBearCount()) spawnBear();
    while (state.workers.length < state.lumberjacks) spawnWorker();
    while (state.hunterUnits.length < state.hunters) spawnHunterUnit();
  }

  function nearestAliveTreeFor(x, y) {
    let best = null, bestDist = Infinity;
    for (const t of state.trees) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  function updateWorkers(dt, now) {
    for (const w of state.workers) {
      if (w.state === 'toTree') {
        if (!w.targetTree || !w.targetTree.alive) {
          w.targetTree = nearestAliveTreeFor(w.x, w.y);
        }
        if (w.targetTree) {
          const dx = w.targetTree.x - w.x, dy = w.targetTree.y - w.y;
          const d = Math.hypot(dx, dy);
          if (d < WORKER_ARRIVE_RANGE) {
            w.state = 'chopping';
          } else {
            w.x += (dx / d) * WORKER_SPEED * dt;
            w.y += (dy / d) * WORKER_SPEED * dt;
          }
        }
      } else if (w.state === 'chopping') {
        const t = w.targetTree;
        if (!t || !t.alive) {
          w.state = 'toTree';
        } else {
          t.hp -= WORKER_CHOP_RATE * dt;
          if (t.hp <= 0) {
            t.alive = false;
            t.respawnAt = now + randRange(8000, 15000);
            state.stats.treesChopped++;
            w.wood = Math.min(WORKER_CAPACITY, w.wood + Math.floor(randRange(1, 4)));
            w.targetTree = null;
            w.state = 'toBase';
          }
        }
      } else if (w.state === 'toBase') {
        const dx = BASE_X - w.x, dy = BASE_Y - w.y;
        const d = Math.hypot(dx, dy);
        if (d < DEPOT_RADIUS) {
          state.stockpile = Math.min(STOCKPILE_CAP, state.stockpile + w.wood);
          w.wood = 0;
          w.state = 'toTree';
        } else {
          w.x += (dx / d) * WORKER_SPEED * dt;
          w.y += (dy / d) * WORKER_SPEED * dt;
        }
      }
      resolveWallCollision(w, NPC_RADIUS, false);
    }
  }

  function nearestAliveBearWithin(x, y, maxDist) {
    let best = null, bestDist = Infinity;
    for (const b of state.bears) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < maxDist && d < bestDist) { best = b; bestDist = d; }
    }
    return best;
  }

  function updateHunterUnits(dt, now) {
    for (const h of state.hunterUnits) {
      if (h.state === 'patrol') {
        if (now >= h.patrolChangeAt) {
          h.patrolAngle = randRange(0, Math.PI * 2);
          h.patrolChangeAt = now + randRange(2000, 4500);
        }
        const targetX = BASE_X + Math.cos(h.patrolAngle) * HUNTER_PATROL_RADIUS;
        const targetY = BASE_Y + Math.sin(h.patrolAngle) * HUNTER_PATROL_RADIUS;
        const dx = targetX - h.x, dy = targetY - h.y;
        const d = Math.hypot(dx, dy);
        if (d > 10) {
          h.x += (dx / d) * HUNTER_SPEED * 0.5 * dt;
          h.y += (dy / d) * HUNTER_SPEED * 0.5 * dt;
        }
        const bear = nearestAliveBearWithin(h.x, h.y, territoryRadius());
        if (bear) { h.targetBear = bear; h.state = 'chasing'; }
      } else if (h.state === 'chasing') {
        if (!h.targetBear || !h.targetBear.alive) {
          h.targetBear = null;
          h.state = 'patrol';
        } else {
          const dx = h.targetBear.x - h.x, dy = h.targetBear.y - h.y;
          const d = Math.hypot(dx, dy);
          if (d < HUNTER_ATTACK_RANGE) {
            h.state = 'attacking';
          } else {
            h.x += (dx / d) * HUNTER_SPEED * dt;
            h.y += (dy / d) * HUNTER_SPEED * dt;
          }
        }
      } else if (h.state === 'attacking') {
        const bear = h.targetBear;
        if (!bear || !bear.alive) {
          h.targetBear = null;
          h.state = 'patrol';
        } else {
          const d = Math.hypot(bear.x - h.x, bear.y - h.y);
          if (d > HUNTER_ATTACK_RANGE) {
            h.state = 'chasing';
          } else {
            bear.hp -= HUNTER_DPS * dt;
            if (bear.hp <= 0) {
              bear.alive = false;
              bear.respawnAt = now + randRange(4000, 9000);
              h.targetBear = null;
              h.state = 'patrol';
              sfx.bearDown();
              bearKillReward(bear.x, bear.y);
            }
          }
        }
      }
      resolveWallCollision(h, NPC_RADIUS, false);
    }
  }

  // ---------- Input: joystick ----------
  const joyBase = document.getElementById('joyBase');
  const joyStick = document.getElementById('joyStick');
  let joyActive = false;
  let joyVec = { x: 0, y: 0 };
  let joyPointerId = null;

  function joyRect() { return joyBase.getBoundingClientRect(); }

  function updateJoyFromPoint(clientX, clientY) {
    const rect = joyRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const maxR = rect.width / 2;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    joyStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    joyVec.x = dx / maxR;
    joyVec.y = dy / maxR;
  }

  function resetJoy() {
    joyActive = false;
    joyPointerId = null;
    joyVec.x = 0; joyVec.y = 0;
    joyStick.style.transform = 'translate(-50%, -50%)';
  }

  joyBase.addEventListener('pointerdown', (e) => {
    joyActive = true;
    joyPointerId = e.pointerId;
    joyBase.setPointerCapture(e.pointerId);
    updateJoyFromPoint(e.clientX, e.clientY);
  });
  joyBase.addEventListener('pointermove', (e) => {
    if (!joyActive || e.pointerId !== joyPointerId) return;
    updateJoyFromPoint(e.clientX, e.clientY);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
    joyBase.addEventListener(ev, (e) => {
      if (e.pointerId === joyPointerId) resetJoy();
    });
  });

  // Keyboard fallback (desktop testing)
  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') e.preventDefault(); // avoid scrolling the page
    keys[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  function getMoveVector() {
    if (joyActive && (Math.abs(joyVec.x) > 0.05 || Math.abs(joyVec.y) > 0.05)) {
      return { x: joyVec.x, y: joyVec.y };
    }
    let x = 0, y = 0;
    if (keys['arrowleft'] || keys['q'] || keys['a']) x -= 1;
    if (keys['arrowright'] || keys['d']) x += 1;
    if (keys['arrowup'] || keys['z'] || keys['w']) y -= 1;
    if (keys['arrowdown'] || keys['s']) y += 1;
    const len = Math.hypot(x, y);
    if (len > 0) { x /= len; y /= len; }
    return { x, y };
  }

  // ---------- Auto-chop: nearest living tree in range ----------
  function findNearestTree() {
    let best = null, bestDist = Infinity;
    for (const t of state.trees) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - state.player.x, t.y - state.player.y);
      if (d < CHOP_RANGE && d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  // ---------- Attack button: nearest living bear in range ----------
  const attackWrap = document.getElementById('attackWrap');
  const attackBtn = document.getElementById('attackBtn');

  attackBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.attackTarget) state.attacking = true;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
    attackBtn.addEventListener(ev, () => { state.attacking = false; });
  });

  function findNearestBear() {
    let best = null, bestDist = Infinity;
    for (const b of state.bears) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - state.player.x, b.y - state.player.y);
      if (d < PLAYER_ATTACK_RANGE && d < bestDist) { best = b; bestDist = d; }
    }
    return best;
  }

  // ---------- Shop ----------
  const shopBtn = document.getElementById('shopBtn');
  const shopOverlay = document.getElementById('shopOverlay');
  const closeShopBtn = document.getElementById('closeShopBtn');
  const shopList = document.getElementById('shopList');
  const towerModeHint = document.getElementById('towerModeHint');

  const SHOP_ITEMS = [
    {
      kind: 'lumberjack', title: 'Bûcheron',
      desc: 'Coupe des arbres et ramène le bois au dépôt',
      getCount: () => state.lumberjacks,
    },
    {
      kind: 'seller', title: 'Vendeur',
      desc: '+1.0 bois/s converti en pièces',
      getCount: () => state.sellers,
    },
    {
      kind: 'hunter', title: 'Chasseur',
      desc: 'Patrouille et combat les ours du territoire, réduit les dégâts subis',
      getCount: () => state.hunters,
    },
    {
      kind: 'tower', title: 'Tour de guet',
      desc: 'Repousse et blesse les ours à proximité (placement sur la carte)',
      getCount: () => state.towers.length,
    },
    {
      kind: 'wall', title: 'Mur',
      desc: 'Bloque le passage des ours (et le tien) - place-les côte à côte',
      getCount: () => state.walls.length,
    },
    {
      kind: 'door', title: 'Porte',
      desc: 'Bloque les ours mais te laisse passer, toi et tes équipes',
      getCount: () => state.doors.length,
    },
    {
      kind: 'territory', title: 'Agrandir le territoire',
      desc: '+150 de rayon sûr, plus d\'arbres disponibles',
      getCount: () => state.territoryLevel,
    },
  ];

  const PLACEMENT_HINTS = {
    tower: 'Touche la carte pour placer la tour (Annuler)',
    wall: 'Touche la carte pour placer un mur (Annuler)',
    door: 'Touche la carte pour placer une porte (Annuler)',
  };

  function renderShop() {
    shopList.innerHTML = '';
    for (const item of SHOP_ITEMS) {
      const count = item.getCount();
      const cost = costOf(item.kind, count);
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="shop-item-info">
          <div class="shop-item-title">${item.title}</div>
          <div class="shop-item-desc">${item.desc}</div>
          <div class="shop-item-count">Possédé : ${count}</div>
        </div>
        <button class="buy-btn" ${state.coins < cost ? 'disabled' : ''}>${cost} 🪙</button>
      `;
      row.querySelector('.buy-btn').addEventListener('click', () => buyItem(item.kind));
      shopList.appendChild(row);
    }
  }

  function buyItem(kind) {
    if (PLACEMENT_HINTS[kind]) {
      const arr = kind === 'tower' ? state.towers : kind === 'wall' ? state.walls : state.doors;
      const cost = costOf(kind, arr.length);
      if (state.coins < cost) return;
      shopOverlay.classList.add('hidden');
      state.placementMode = kind;
      towerModeHint.textContent = PLACEMENT_HINTS[kind];
      towerModeHint.classList.remove('hidden');
      return;
    }
    const countKey = kind === 'territory' ? 'territoryLevel' : kind + 's';
    const cost = costOf(kind, state[countKey]);
    if (state.coins < cost) return;
    state.coins -= cost;
    state[countKey] += 1;
    if (kind === 'lumberjack') spawnWorker();
    if (kind === 'hunter') spawnHunterUnit();
    ensurePopulation();
    renderShop();
    save();
  }

  shopBtn.addEventListener('click', () => {
    renderShop();
    shopOverlay.classList.remove('hidden');
  });
  closeShopBtn.addEventListener('click', () => shopOverlay.classList.add('hidden'));

  const achievementsBtn = document.getElementById('achievementsBtn');
  const achievementsOverlay = document.getElementById('achievementsOverlay');
  const closeAchievementsBtn = document.getElementById('closeAchievementsBtn');
  const achievementsList = document.getElementById('achievementsList');

  function renderAchievements() {
    achievementsList.innerHTML = '';
    for (const ach of ACHIEVEMENTS) {
      const unlocked = state.unlockedAchievements.includes(ach.id);
      const row = document.createElement('div');
      row.className = `ach-item${unlocked ? '' : ' locked'}`;
      row.innerHTML = `
        <div class="ach-icon">${unlocked ? '🏆' : '🔒'}</div>
        <div>
          <div class="ach-title">${ach.title}</div>
          <div class="ach-desc">${ach.desc} ${unlocked ? '' : `(+${ach.reward} 🪙)`}</div>
        </div>
      `;
      achievementsList.appendChild(row);
    }
  }

  achievementsBtn.addEventListener('click', () => {
    renderAchievements();
    achievementsOverlay.classList.remove('hidden');
  });
  closeAchievementsBtn.addEventListener('click', () => achievementsOverlay.classList.add('hidden'));

  towerModeHint.addEventListener('click', () => {
    state.placementMode = null;
    towerModeHint.classList.add('hidden');
  });

  // ---------- Canvas tap: place tower / wall / door ----------
  canvas.addEventListener('pointerdown', (e) => {
    const mode = state.placementMode;
    if (!mode) return;
    const worldX = state.player.x + (e.clientX - cssWidth / 2);
    const worldY = state.player.y + (e.clientY - cssHeight / 2);
    const distFromBase = Math.hypot(worldX - BASE_X, worldY - BASE_Y);

    if (mode === 'tower') {
      if (distFromBase > territoryRadius() || distFromBase < 90) return;
      const tooClose = state.towers.some(t => Math.hypot(t.x - worldX, t.y - worldY) < 80);
      if (tooClose) return;
      const cost = costOf('tower', state.towers.length);
      if (state.coins < cost) return;
      state.coins -= cost;
      state.towers.push({ x: worldX, y: worldY });
    } else {
      if (distFromBase > territoryRadius() + 40 || distFromBase < 60) return;
      const combined = state.walls.concat(state.doors);
      const tooClose = combined.some(o => Math.hypot(o.x - worldX, o.y - worldY) < WALL_MIN_SEPARATION);
      if (tooClose) return;
      const arr = mode === 'wall' ? state.walls : state.doors;
      const cost = costOf(mode, arr.length);
      if (state.coins < cost) return;
      state.coins -= cost;
      arr.push({ x: worldX, y: worldY });
    }

    state.placementMode = null;
    towerModeHint.classList.add('hidden');
    save();
  });

  // ---------- Death / revive / full reset ----------
  const deathOverlay = document.getElementById('deathOverlay');
  const deathInfo = document.getElementById('deathInfo');
  const reviveBtn = document.getElementById('reviveBtn');
  const giveUpBtn = document.getElementById('giveUpBtn');
  const restartGameBtn = document.getElementById('restartGameBtn');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmYesBtn = document.getElementById('confirmYesBtn');
  const confirmNoBtn = document.getElementById('confirmNoBtn');
  const welcomeBackOverlay = document.getElementById('welcomeBackOverlay');
  const welcomeBackInfo = document.getElementById('welcomeBackInfo');
  const welcomeBackOkBtn = document.getElementById('welcomeBackOkBtn');

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min`;
    return `${Math.floor(seconds)} s`;
  }

  welcomeBackOkBtn.addEventListener('click', () => welcomeBackOverlay.classList.add('hidden'));

  function killPlayer() {
    if (state.dead) return;
    state.dead = true;
    sfx.death();
    triggerShake(12);
    const cost = reviveCost();
    const canAfford = state.coins >= cost;
    deathInfo.textContent = state.player.wood > 0
      ? `Tu as perdu ${Math.floor(state.player.wood)} bois transporté.`
      : `Un ours t'a rattrapé.`;
    reviveBtn.textContent = `Payer ${cost} 🪙 et revivre`;
    reviveBtn.disabled = !canAfford;
    deathOverlay.classList.remove('hidden');
  }

  reviveBtn.addEventListener('click', () => {
    const cost = reviveCost();
    if (state.coins < cost) return;
    state.coins -= cost;
    state.player.x = BASE_X;
    state.player.y = BASE_Y - 40;
    state.player.hp = PLAYER_MAX_HP;
    state.player.wood = 0;
    state.player.invulnerableUntil = performance.now() + 2000;
    state.dead = false;
    deathOverlay.classList.add('hidden');
    sfx.revive();
    save();
  });

  function performFullReset() {
    state.coins = 0;
    state.stockpile = 0;
    state.lumberjacks = 0;
    state.sellers = 0;
    state.hunters = 0;
    state.territoryLevel = 0;
    state.towers = [];
    state.walls = [];
    state.doors = [];
    state.trees = [];
    state.bears = [];
    state.workers = [];
    state.hunterUnits = [];
    state.player.x = BASE_X;
    state.player.y = BASE_Y - 40;
    state.player.hp = PLAYER_MAX_HP;
    state.player.wood = 0;
    state.player.lastHitAt = -999;
    state.player.invulnerableUntil = 0;
    state.player.facing = 0;
    state.chopTarget = null;
    state.placementMode = null;
    state.dead = false;
    state.chests = [];
    state.popups = [];
    state.particles = [];
    state.stats = { treesChopped: 0, bearsKilled: 0 };
    state.unlockedAchievements = [];
    nextChestAt = performance.now() + randRange(15000, 40000);
    for (let i = 0; i < maxTrees(); i++) spawnTree();
    for (let i = 0; i < targetBearCount(); i++) spawnBear();
    localStorage.removeItem('lumberjackSave');
    save();
    deathOverlay.classList.add('hidden');
    shopOverlay.classList.add('hidden');
    renderShop();
  }

  let confirmAction = null;
  function askConfirm(action) {
    confirmAction = action;
    confirmOverlay.classList.remove('hidden');
  }
  confirmYesBtn.addEventListener('click', () => {
    confirmOverlay.classList.add('hidden');
    if (confirmAction) confirmAction();
  });
  confirmNoBtn.addEventListener('click', () => {
    confirmOverlay.classList.add('hidden');
    confirmAction = null;
  });

  giveUpBtn.addEventListener('click', () => askConfirm(performFullReset));
  restartGameBtn.addEventListener('click', () => askConfirm(performFullReset));

  // ---------- HUD refs ----------
  const coinsLabel = document.getElementById('coinsLabel');
  const woodLabel = document.getElementById('woodLabel');
  const hpBar = document.getElementById('hpBar');
  const sellHint = document.getElementById('sellHint');

  // ---------- Update loop ----------
  let last = performance.now();
  let saveTimer = 0;
  let lastCoinSoundAt = -999;

  function update(dt, now) {
    const p = state.player;

    if (!state.dead) {
      const move = getMoveVector();
      if (move.x !== 0 || move.y !== 0) {
        p.x += move.x * PLAYER_SPEED * dt;
        p.y += move.y * PLAYER_SPEED * dt;
        p.facing = Math.atan2(move.y, move.x);
        p.x = Math.max(20, Math.min(WORLD_SIZE - 20, p.x));
        p.y = Math.max(20, Math.min(WORLD_SIZE - 20, p.y));
        resolveWallCollision(p, PLAYER_RADIUS, false);
      }

      // HP regen
      if (now - p.lastHitAt > 4000 && p.hp < PLAYER_MAX_HP) {
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + 3 * dt);
      }

      // Auto-chop the nearest tree in range
      state.chopTarget = findNearestTree();
      if (state.chopTarget) {
        const t = state.chopTarget;
        t.hp -= CHOP_RATE * dt;
        if (t.hp <= 0) {
          t.alive = false;
          t.respawnAt = now + randRange(8000, 15000);
          state.stats.treesChopped++;
          if (t.golden) {
            const gained = Math.round(randRange(8, 15));
            const bonusCoins = Math.round(randRange(20, 40));
            p.wood = Math.min(p.woodCapacity, p.wood + gained);
            state.coins += bonusCoins;
            sfx.bonus();
            spawnPopup(t.x, t.y - 30, `✨ +${gained} 🪵 +${bonusCoins} 🪙`, '#ffd166');
            spawnParticles(t.x, t.y - 16, 14, ['#ffd166', '#f1c40f', '#fff3b0']);
          } else {
            const gained = Math.floor(randRange(1, 4));
            p.wood = Math.min(p.woodCapacity, p.wood + gained);
            sfx.harvest();
            spawnPopup(t.x, t.y - 30, `+${gained} 🪵`, '#c9a66b');
            spawnParticles(t.x, t.y - 16, 8, ['#6b4321', '#2e7d42']);
          }
        }
      }

      // Attack button (or spacebar): damage the nearest bear in range while held
      state.attackTarget = findNearestBear();
      attackWrap.classList.toggle('hidden', !state.attackTarget);
      if ((state.attacking || keys[' ']) && state.attackTarget && state.attackTarget.alive) {
        const b = state.attackTarget;
        b.hp -= PLAYER_ATTACK_DPS * dt;
        if (b.hp <= 0) {
          b.alive = false;
          b.respawnAt = now + randRange(4000, 9000);
          sfx.bearDown();
          bearKillReward(b.x, b.y);
          state.attacking = false;
        }
      }

      // Selling at depot
      const distDepot = Math.hypot(p.x - BASE_X, p.y - BASE_Y);
      const atDepot = distDepot < DEPOT_RADIUS;
      sellHint.classList.toggle('hidden', !(atDepot && p.wood > 0));
      if (atDepot && p.wood > 0) {
        const sold = Math.min(p.wood, SELL_RATE * dt);
        p.wood -= sold;
        state.coins += sold * WOOD_PRICE;
        if (now - lastCoinSoundAt > 350) { lastCoinSoundAt = now; sfx.coin(); }
      }
    }

    // Tree respawn
    for (const t of state.trees) {
      if (!t.alive && now >= t.respawnAt) {
        t.alive = true;
        t.hp = TREE_MAX_HP;
        t.golden = Math.random() < GOLDEN_TREE_CHANCE;
      }
    }
    ensurePopulation();
    updateWorkers(dt, now);

    // Chests: rare, occasional bonus pickup
    maybeSpawnChest(now);
    if (!state.dead) {
      for (let i = state.chests.length - 1; i >= 0; i--) {
        const chest = state.chests[i];
        if (Math.hypot(chest.x - p.x, chest.y - p.y) < CHEST_PICKUP_RADIUS) {
          const coinsWon = Math.round(randRange(20, 60));
          state.coins += coinsWon;
          sfx.bonus();
          spawnPopup(chest.x, chest.y - 20, `🎁 +${coinsWon} 🪙`, '#ffd166');
          spawnParticles(chest.x, chest.y - 10, 12, ['#ffd166', '#f1c40f', '#e8b923']);
          state.chests.splice(i, 1);
        }
      }
    }

    // Passive economy: a baseline sale rate always applies, Vendeurs add more on top
    if (state.stockpile > 0) {
      const rate = BASE_SELL_RATE + state.sellers * 1.0;
      const sold = Math.min(state.stockpile, rate * dt);
      state.stockpile -= sold;
      state.coins += sold * WOOD_PRICE;
    }

    updateHunterUnits(dt, now);

    // Towers: damage + repel nearby bears
    for (const tower of state.towers) {
      for (const b of state.bears) {
        if (!b.alive) continue;
        const dx = b.x - tower.x, dy = b.y - tower.y;
        const d = Math.hypot(dx, dy);
        if (d < TOWER_RADIUS && d > 0.01) {
          b.hp -= TOWER_DPS * dt;
          const push = 60 * dt;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
          if (b.hp <= 0) {
            b.alive = false;
            b.respawnAt = now + randRange(4000, 9000);
            sfx.bearDown();
            bearKillReward(b.x, b.y);
          }
        }
      }
    }

    // Bears: wander / chase / attack, respawn
    for (const b of state.bears) {
      if (!b.alive) {
        if (now >= b.respawnAt) {
          const pos = randomWorldPos(territoryRadius() + 150);
          b.x = pos.x; b.y = pos.y; b.hp = BEAR_MAX_HP; b.alive = true;
        }
        continue;
      }
      const distPlayer = Math.hypot(b.x - p.x, b.y - p.y);
      if (!state.dead && distPlayer < BEAR_AGGRO_RANGE) {
        const dx = p.x - b.x, dy = p.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        b.dirX = dx / d; b.dirY = dy / d;
        b.x += b.dirX * 110 * dt;
        b.y += b.dirY * 110 * dt;
        if (distPlayer < BEAR_ATTACK_RANGE && now - p.lastHitAt > 900 && now > p.invulnerableUntil) {
          p.lastHitAt = now;
          const dmg = BEAR_DAMAGE * (1 - hunterDamageReduction());
          p.hp -= dmg;
          sfx.hit();
          spawnPopup(p.x, p.y - 20, `-${Math.round(dmg)}`, '#e74c3c');
          triggerShake(6);
          if (p.hp <= 0) { p.hp = 0; killPlayer(); }
        }
      } else {
        if (now >= b.changeDirAt) {
          const angle = randRange(0, Math.PI * 2);
          b.dirX = Math.cos(angle); b.dirY = Math.sin(angle);
          b.changeDirAt = now + randRange(2000, 4500);
        }
        b.x += b.dirX * 70 * dt;
        b.y += b.dirY * 70 * dt;
      }
      b.x = Math.max(20, Math.min(WORLD_SIZE - 20, b.x));
      b.y = Math.max(20, Math.min(WORLD_SIZE - 20, b.y));
      resolveWallCollision(b, BEAR_RADIUS, true);
    }

    // Popups & particles
    state.popups = state.popups.filter(p => now - p.createdAt < POPUP_LIFETIME);
    state.particles = state.particles.filter(pt => now - pt.createdAt < pt.life);
    for (const pt of state.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 220 * dt; // gravity
    }

    checkAchievements();

    // HUD
    coinsLabel.textContent = Math.floor(state.coins);
    woodLabel.textContent = `${Math.floor(p.wood)}/${p.woodCapacity}`;
    hpBar.style.width = `${Math.max(0, (p.hp / PLAYER_MAX_HP) * 100)}%`;

    saveTimer += dt;
    if (saveTimer > 3) { saveTimer = 0; save(); }
  }

  // ---------- Render ----------
  function worldToScreen(x, y) {
    return { x: cssWidth / 2 + (x - state.player.x), y: cssHeight / 2 + (y - state.player.y) };
  }

  function draw() {
    let shakeX = 0, shakeY = 0;
    const now = performance.now();
    if (now < shakeUntil) {
      const power = shakeMagnitude * ((shakeUntil - now) / SHAKE_DURATION);
      shakeX = (Math.random() * 2 - 1) * power;
      shakeY = (Math.random() * 2 - 1) * power;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    ctx.fillStyle = '#1c3320';
    ctx.fillRect(-20, -20, cssWidth + 40, cssHeight + 40);

    // subtle ground dots
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    const camX = state.player.x, camY = state.player.y;
    const startX = Math.floor((camX - cssWidth / 2) / 64) * 64;
    const startY = Math.floor((camY - cssHeight / 2) / 64) * 64;
    for (let wx = startX; wx < camX + cssWidth / 2; wx += 64) {
      for (let wy = startY; wy < camY + cssHeight / 2; wy += 64) {
        const s = worldToScreen(wx, wy);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // territory circle
    const baseScreen = worldToScreen(BASE_X, BASE_Y);
    ctx.strokeStyle = 'rgba(255, 224, 130, 0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(baseScreen.x, baseScreen.y, territoryRadius(), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // depot
    ctx.fillStyle = '#8d5a2b';
    ctx.fillRect(baseScreen.x - 26, baseScreen.y - 20, 52, 40);
    ctx.fillStyle = '#5c3a1a';
    ctx.beginPath();
    ctx.moveTo(baseScreen.x - 32, baseScreen.y - 20);
    ctx.lineTo(baseScreen.x, baseScreen.y - 46);
    ctx.lineTo(baseScreen.x + 32, baseScreen.y - 20);
    ctx.closePath();
    ctx.fill();

    // towers
    for (const tower of state.towers) {
      const s = worldToScreen(tower.x, tower.y);
      ctx.strokeStyle = 'rgba(155, 89, 182, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, TOWER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#7f6a52';
      ctx.fillRect(s.x - 10, s.y - 30, 20, 40);
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath();
      ctx.moveTo(s.x + 10, s.y - 30);
      ctx.lineTo(s.x + 26, s.y - 24);
      ctx.lineTo(s.x + 10, s.y - 18);
      ctx.closePath();
      ctx.fill();
    }

    // walls
    for (const w of state.walls) {
      const s = worldToScreen(w.x, w.y);
      if (s.x < -30 || s.x > cssWidth + 30 || s.y < -30 || s.y > cssHeight + 30) continue;
      ctx.fillStyle = '#5c4530';
      ctx.beginPath();
      ctx.arc(s.x, s.y, WALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3d3120';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // doors
    for (const d of state.doors) {
      const s = worldToScreen(d.x, d.y);
      if (s.x < -30 || s.x > cssWidth + 30 || s.y < -30 || s.y > cssHeight + 30) continue;
      ctx.fillStyle = '#c9a66b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, WALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8d6b3f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, WALL_RADIUS - 7, -Math.PI * 0.75, Math.PI * -0.25);
      ctx.stroke();
    }

    // trees
    for (const t of state.trees) {
      if (!t.alive) continue;
      const s = worldToScreen(t.x, t.y);
      if (s.x < -50 || s.x > cssWidth + 50 || s.y < -50 || s.y > cssHeight + 50) continue;
      ctx.fillStyle = '#6b4321';
      ctx.fillRect(s.x - 6, s.y - 8, 12, 26);
      ctx.fillStyle = t.golden ? '#f1c40f' : '#2e7d42';
      ctx.beginPath();
      ctx.arc(s.x, s.y - 22, TREE_CANOPY_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      if (t.golden) {
        ctx.strokeStyle = 'rgba(255, 243, 176, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 22, TREE_CANOPY_RADIUS + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (state.chopTarget === t) {
        const ratio = Math.max(0, t.hp / TREE_MAX_HP);
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 22, TREE_CANOPY_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - ratio));
        ctx.stroke();
      }
    }

    // chests
    for (const chest of state.chests) {
      const s = worldToScreen(chest.x, chest.y);
      if (s.x < -30 || s.x > cssWidth + 30 || s.y < -30 || s.y > cssHeight + 30) continue;
      const pulse = 4 + Math.sin(performance.now() / 250) * 3;
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 22 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#8d5a2b';
      ctx.fillRect(s.x - 14, s.y - 8, 28, 16);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(s.x - 14, s.y - 10, 28, 5);
      ctx.fillStyle = '#e8b923';
      ctx.fillRect(s.x - 3, s.y - 8, 6, 16);
    }

    // workers (hired lumberjacks)
    for (const w of state.workers) {
      const s = worldToScreen(w.x, w.y);
      if (s.x < -30 || s.x > cssWidth + 30 || s.y < -30 || s.y > cssHeight + 30) continue;
      ctx.fillStyle = '#c9852b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (w.wood > 0) {
        ctx.fillStyle = '#8d5a2b';
        ctx.fillRect(s.x - 5, s.y - 20, 10, 8);
      }
    }

    // hunter units
    for (const h of state.hunterUnits) {
      const s = worldToScreen(h.x, h.y);
      if (s.x < -30 || s.x > cssWidth + 30 || s.y < -30 || s.y > cssHeight + 30) continue;
      ctx.fillStyle = h.state === 'attacking' ? '#e74c3c' : '#7f8c8d';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#2c3e50';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - 8, s.y + 8);
      ctx.lineTo(s.x + 8, s.y - 8);
      ctx.stroke();
    }

    // bears
    for (const b of state.bears) {
      if (!b.alive) continue;
      const s = worldToScreen(b.x, b.y);
      if (s.x < -40 || s.x > cssWidth + 40 || s.y < -40 || s.y > cssHeight + 40) continue;
      const aggro = Math.hypot(b.x - state.player.x, b.y - state.player.y) < BEAR_AGGRO_RANGE;
      ctx.fillStyle = aggro ? '#7a3b1e' : '#5c3a2e';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x - 10, s.y - 12, 6, 0, Math.PI * 2);
      ctx.arc(s.x + 10, s.y - 12, 6, 0, Math.PI * 2);
      ctx.fill();
      // hp bar
      const ratio = Math.max(0, b.hp / BEAR_MAX_HP);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(s.x - 16, s.y - 30, 32, 4);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(s.x - 16, s.y - 30, 32 * ratio, 4);
      if (state.attacking && state.attackTarget === b) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 22, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // player
    if (!state.dead) {
      const s = worldToScreen(state.player.x, state.player.y);
      const flashing = performance.now() < state.player.invulnerableUntil && Math.floor(performance.now() / 100) % 2 === 0;
      ctx.globalAlpha = flashing ? 0.4 : 1;
      ctx.fillStyle = '#3498db';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(state.player.facing) * 22, s.y + Math.sin(state.player.facing) * 22);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // particles
    for (const pt of state.particles) {
      const s = worldToScreen(pt.x, pt.y);
      const age = performance.now() - pt.createdAt;
      const alpha = Math.max(0, 1 - age / pt.life);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(s.x - pt.size / 2, s.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // popups
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px sans-serif';
    for (const popup of state.popups) {
      const age = performance.now() - popup.createdAt;
      const ratio = age / POPUP_LIFETIME;
      const s = worldToScreen(popup.x, popup.y - ratio * 40);
      ctx.globalAlpha = Math.max(0, 1 - ratio);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(popup.text, s.x + 1, s.y + 1);
      ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    renderMinimap();
  }

  function renderMinimap() {
    const cx = MINIMAP_SIZE / 2, cy = MINIMAP_SIZE / 2;
    const scale = (MINIMAP_SIZE / 2) / MINIMAP_WORLD_RADIUS;
    const toMini = (x, y) => ({
      x: cx + (x - state.player.x) * scale,
      y: cy + (y - state.player.y) * scale,
    });

    minimapCtx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    minimapCtx.save();
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, MINIMAP_SIZE / 2, 0, Math.PI * 2);
    minimapCtx.clip();
    minimapCtx.fillStyle = '#152a19';
    minimapCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    const baseM = toMini(BASE_X, BASE_Y);
    minimapCtx.strokeStyle = 'rgba(255, 224, 130, 0.5)';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.arc(baseM.x, baseM.y, territoryRadius() * scale, 0, Math.PI * 2);
    minimapCtx.stroke();

    minimapCtx.fillStyle = '#8d5a2b';
    minimapCtx.beginPath();
    minimapCtx.arc(baseM.x, baseM.y, 4, 0, Math.PI * 2);
    minimapCtx.fill();

    minimapCtx.fillStyle = '#2e7d42';
    for (const t of state.trees) {
      if (!t.alive) continue;
      if (Math.hypot(t.x - state.player.x, t.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(t.x, t.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 2, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#c9852b';
    for (const w of state.workers) {
      if (Math.hypot(w.x - state.player.x, w.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(w.x, w.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 2, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#7f8c8d';
    for (const h of state.hunterUnits) {
      if (Math.hypot(h.x - state.player.x, h.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(h.x, h.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 2, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#5c4530';
    for (const w of state.walls) {
      if (Math.hypot(w.x - state.player.x, w.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(w.x, w.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#c9a66b';
    for (const d of state.doors) {
      if (Math.hypot(d.x - state.player.x, d.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(d.x, d.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#ffd166';
    for (const chest of state.chests) {
      if (Math.hypot(chest.x - state.player.x, chest.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(chest.x, chest.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#e74c3c';
    for (const b of state.bears) {
      if (!b.alive) continue;
      if (Math.hypot(b.x - state.player.x, b.y - state.player.y) > MINIMAP_WORLD_RADIUS) continue;
      const m = toMini(b.x, b.y);
      minimapCtx.beginPath();
      minimapCtx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.fillStyle = '#3498db';
    minimapCtx.beginPath();
    minimapCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    minimapCtx.fill();

    minimapCtx.restore();
  }

  // ---------- Main loop ----------
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt, now);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- Init ----------
  load();
  for (let i = 0; i < maxTrees(); i++) spawnTree();
  for (let i = 0; i < targetBearCount(); i++) spawnBear();
  for (let i = 0; i < state.lumberjacks; i++) spawnWorker();
  for (let i = 0; i < state.hunters; i++) spawnHunterUnit();
  nextChestAt = performance.now() + randRange(15000, 40000);
  renderShop();

  if (offlineEarnings) {
    welcomeBackInfo.textContent = `Pendant ton absence (${formatDuration(offlineEarnings.seconds)}), tes bûcherons ont vendu ${offlineEarnings.logsSold} bois, générant ${offlineEarnings.coinsEarned} 🪙.`;
    welcomeBackOverlay.classList.remove('hidden');
  }

  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
})();
