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

  // ---------- World constants ----------
  const WORLD_SIZE = 3200;
  const BASE_X = WORLD_SIZE / 2;
  const BASE_Y = WORLD_SIZE / 2;
  const DEPOT_RADIUS = 70;
  const CHOP_RANGE = 60;
  const CHOP_RATE = 32; // tree hp per second
  const TREE_MAX_HP = 60;
  const WOOD_PRICE = 5;
  const SELL_RATE = 4; // logs per second when at depot
  const PLAYER_SPEED = 210;
  const PLAYER_MAX_HP = 100;
  const BEAR_AGGRO_RANGE = 160;
  const BEAR_ATTACK_RANGE = 34;
  const BEAR_DAMAGE = 9;
  const BEAR_MAX_HP = 60;
  const TOWER_RADIUS = 170;
  const TOWER_DPS = 22;

  const COSTS = {
    lumberjack: { base: 20, growth: 1.15 },
    seller: { base: 30, growth: 1.15 },
    hunter: { base: 60, growth: 1.2 },
    tower: { base: 90, growth: 1.25 },
    territory: { base: 120, growth: 1.4 },
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
    chopping: false,
    chopTarget: null,
    towerPlacementMode: false,
    dead: false,
  };

  function territoryRadius() {
    return 300 + state.territoryLevel * 150;
  }

  function maxTrees() {
    return 40 + state.territoryLevel * 8;
  }

  function targetBearCount() {
    return Math.min(3 + state.territoryLevel, 12);
  }

  function hunterDamageReduction() {
    return Math.min(0.5, state.hunters * 0.05);
  }

  // ---------- Persistence ----------
  function save() {
    const data = {
      coins: state.coins,
      stockpile: state.stockpile,
      lumberjacks: state.lumberjacks,
      sellers: state.sellers,
      hunters: state.hunters,
      territoryLevel: state.territoryLevel,
      towers: state.towers,
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

  function spawnTree() {
    const pos = randomWorldPos(120);
    state.trees.push({ x: pos.x, y: pos.y, hp: TREE_MAX_HP, alive: true, respawnAt: 0 });
  }

  function spawnBear() {
    const pos = randomWorldPos(territoryRadius() + 150);
    state.bears.push({
      x: pos.x, y: pos.y, hp: BEAR_MAX_HP,
      dirX: 0, dirY: 0, changeDirAt: 0, alive: true, respawnAt: 0,
    });
  }

  function ensurePopulation() {
    while (state.trees.filter(t => t.alive).length < maxTrees() && state.trees.length < maxTrees() + 5) {
      spawnTree();
    }
    while (state.bears.length < targetBearCount()) spawnBear();
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
  window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
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

  // ---------- Input: chop button ----------
  const chopWrap = document.getElementById('chopWrap');
  const chopBtn = document.getElementById('chopBtn');
  const chopRing = document.getElementById('chopRing').querySelector('circle');
  const RING_CIRC = 2 * Math.PI * 19;

  chopBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.chopTarget) state.chopping = true;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
    chopBtn.addEventListener(ev, () => { state.chopping = false; });
  });

  function findNearestTree() {
    let best = null, bestDist = Infinity;
    for (const t of state.trees) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - state.player.x, t.y - state.player.y);
      if (d < CHOP_RANGE && d < bestDist) { best = t; bestDist = d; }
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
      desc: '+0.6 bois/s automatiquement au dépôt',
      getCount: () => state.lumberjacks,
    },
    {
      kind: 'seller', title: 'Vendeur',
      desc: '+1.0 bois/s converti en pièces',
      getCount: () => state.sellers,
    },
    {
      kind: 'hunter', title: 'Chasseur',
      desc: 'Attaque les ours du territoire, réduit les dégâts subis',
      getCount: () => state.hunters,
    },
    {
      kind: 'tower', title: 'Tour de guet',
      desc: 'Repousse et blesse les ours à proximité (placement sur la carte)',
      getCount: () => state.towers.length,
    },
    {
      kind: 'territory', title: 'Agrandir le territoire',
      desc: '+150 de rayon sûr, plus d\'arbres disponibles',
      getCount: () => state.territoryLevel,
    },
  ];

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
    if (kind === 'tower') {
      const cost = costOf('tower', state.towers.length);
      if (state.coins < cost) return;
      shopOverlay.classList.add('hidden');
      state.towerPlacementMode = true;
      towerModeHint.classList.remove('hidden');
      return;
    }
    const countKey = kind === 'territory' ? 'territoryLevel' : kind + 's';
    const cost = costOf(kind, state[countKey]);
    if (state.coins < cost) return;
    state.coins -= cost;
    state[countKey] += 1;
    ensurePopulation();
    renderShop();
    save();
  }

  shopBtn.addEventListener('click', () => {
    renderShop();
    shopOverlay.classList.remove('hidden');
  });
  closeShopBtn.addEventListener('click', () => shopOverlay.classList.add('hidden'));

  towerModeHint.addEventListener('click', () => {
    state.towerPlacementMode = false;
    towerModeHint.classList.add('hidden');
  });

  // ---------- Canvas tap: tower placement ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.towerPlacementMode) return;
    const worldX = state.player.x + (e.clientX - cssWidth / 2);
    const worldY = state.player.y + (e.clientY - cssHeight / 2);
    const distFromBase = Math.hypot(worldX - BASE_X, worldY - BASE_Y);
    if (distFromBase > territoryRadius() || distFromBase < 90) return;
    const tooClose = state.towers.some(t => Math.hypot(t.x - worldX, t.y - worldY) < 80);
    if (tooClose) return;
    const cost = costOf('tower', state.towers.length);
    if (state.coins < cost) return;
    state.coins -= cost;
    state.towers.push({ x: worldX, y: worldY });
    state.towerPlacementMode = false;
    towerModeHint.classList.add('hidden');
    save();
  });

  // ---------- Death / respawn ----------
  const deathOverlay = document.getElementById('deathOverlay');
  const deathInfo = document.getElementById('deathInfo');
  const respawnBtn = document.getElementById('respawnBtn');

  function killPlayer() {
    if (state.dead) return;
    state.dead = true;
    deathInfo.textContent = state.player.wood > 0
      ? `Tu as perdu ${state.player.wood} bois transporté.`
      : `Reste prudent près des ours.`;
    deathOverlay.classList.remove('hidden');
  }

  respawnBtn.addEventListener('click', () => {
    state.player.x = BASE_X;
    state.player.y = BASE_Y - 40;
    state.player.hp = PLAYER_MAX_HP;
    state.player.wood = 0;
    state.player.invulnerableUntil = performance.now() + 2000;
    state.dead = false;
    deathOverlay.classList.add('hidden');
  });

  // ---------- HUD refs ----------
  const coinsLabel = document.getElementById('coinsLabel');
  const woodLabel = document.getElementById('woodLabel');
  const hpBar = document.getElementById('hpBar');
  const sellHint = document.getElementById('sellHint');

  // ---------- Update loop ----------
  let last = performance.now();
  let saveTimer = 0;
  let lumberjackTimer = 0;
  const hunterTimers = [];

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
      }

      // HP regen
      if (now - p.lastHitAt > 4000 && p.hp < PLAYER_MAX_HP) {
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + 3 * dt);
      }

      // Chopping
      state.chopTarget = findNearestTree();
      chopWrap.classList.toggle('hidden', !state.chopTarget);
      if (state.chopping && state.chopTarget && state.chopTarget.alive) {
        const t = state.chopTarget;
        t.hp -= CHOP_RATE * dt;
        const ratio = Math.max(0, t.hp / TREE_MAX_HP);
        chopRing.style.strokeDashoffset = String(RING_CIRC * ratio);
        if (t.hp <= 0) {
          t.alive = false;
          t.respawnAt = now + randRange(8000, 15000);
          const gained = Math.floor(randRange(1, 4));
          p.wood = Math.min(p.woodCapacity, p.wood + gained);
          state.chopping = false;
        }
      } else {
        chopRing.style.strokeDashoffset = String(RING_CIRC);
      }

      // Selling at depot
      const distDepot = Math.hypot(p.x - BASE_X, p.y - BASE_Y);
      const atDepot = distDepot < DEPOT_RADIUS;
      sellHint.classList.toggle('hidden', !(atDepot && p.wood > 0));
      if (atDepot && p.wood > 0) {
        const sold = Math.min(p.wood, SELL_RATE * dt);
        p.wood -= sold;
        state.coins += sold * WOOD_PRICE;
      }
    }

    // Tree respawn
    for (const t of state.trees) {
      if (!t.alive && now >= t.respawnAt) {
        t.alive = true;
        t.hp = TREE_MAX_HP;
      }
    }
    ensurePopulation();

    // Passive economy
    if (state.lumberjacks > 0) {
      state.stockpile = Math.min(300, state.stockpile + state.lumberjacks * 0.6 * dt);
    }
    if (state.sellers > 0 && state.stockpile > 0) {
      const sold = Math.min(state.stockpile, state.sellers * 1.0 * dt);
      state.stockpile -= sold;
      state.coins += sold * WOOD_PRICE;
    }

    // Hunters: periodically damage a bear inside territory
    while (hunterTimers.length < state.hunters) hunterTimers.push(randRange(0, 6000));
    for (let i = 0; i < state.hunters; i++) {
      hunterTimers[i] -= dt * 1000;
      if (hunterTimers[i] <= 0) {
        hunterTimers[i] = 6000;
        let target = null, bestDist = Infinity;
        for (const b of state.bears) {
          if (!b.alive) continue;
          const d = Math.hypot(b.x - BASE_X, b.y - BASE_Y);
          if (d < territoryRadius() && d < bestDist) { target = b; bestDist = d; }
        }
        if (target) {
          target.hp -= 40;
          if (target.hp <= 0) {
            target.alive = false;
            target.respawnAt = now + randRange(4000, 9000);
            state.coins += 2;
          }
        }
      }
    }

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
            state.coins += 2;
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
    }

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
    ctx.fillStyle = '#1c3320';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

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

    // trees
    for (const t of state.trees) {
      if (!t.alive) continue;
      const s = worldToScreen(t.x, t.y);
      if (s.x < -40 || s.x > cssWidth + 40 || s.y < -40 || s.y > cssHeight + 40) continue;
      ctx.fillStyle = '#6b4321';
      ctx.fillRect(s.x - 4, s.y - 6, 8, 18);
      ctx.fillStyle = '#2e7d42';
      ctx.beginPath();
      ctx.arc(s.x, s.y - 16, 18, 0, Math.PI * 2);
      ctx.fill();
      if (state.chopTarget === t && state.chopping) {
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y - 16, 22, 0, Math.PI * 2);
        ctx.stroke();
      }
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
  renderShop();

  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
})();
