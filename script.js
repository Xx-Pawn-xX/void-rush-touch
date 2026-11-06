(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");
  const game = $("game");

  const ui = {
    score: $("scoreHud"),
    combo: $("comboHud"),
    sector: $("sectorHud"),
    best: $("bestHud"),
    health: $("healthFill"),
    healthText: $("healthText"),

    controlStatus: $("controlStatus"),
    status: $("runStatus"),

    start: $("startOverlay"),
    pause: $("pauseOverlay"),
    over: $("gameOverOverlay"),

    finalScore: $("finalScore"),
    finalCombo: $("finalCombo"),
    finalTime: $("finalTime"),

    dash: $("dashBtn"),
    dashLabel: $("dashLabel"),

    toast: $("toast")
  };

  const STORE = "voidRushTiltRecords_v1";

  let records = { best: 0 };

  try {
    records = {
      ...records,
      ...JSON.parse(localStorage.getItem(STORE) || "{}")
    };
  } catch (_) {}

  let W = 900;
  let H = 560;
  let dpr = 1;

  let mode = "menu";
  let raf = 0;
  let lastTime = 0;
  let elapsed = 0;
  let toastTimer = 0;

  const keys = new Set();
  const touchDirections = new Set();

  let player;
  let enemies = [];
  let shards = [];
  let particles = [];
  let stars = [];

  let score = 0;
  let health = 100;
  let combo = 1;
  let bestCombo = 1;
  let sector = 1;

  let spawnTimer = 0;
  let shardTimer = 0;
  let damageTimer = 0;

  let dashCooldown = 0;
  let dashTime = 0;
  let dashDirection = { x: 0, y: -1 };

  let screenShake = 0;

  const rand = (a, b) =>
    Math.random() * (b - a) + a;

  const clamp = (n, a, b) =>
    Math.max(a, Math.min(b, n));

  const pad = n =>
    String(Math.floor(n)).padStart(6, "0");

  const timeText = n =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  /* ==========================================
     CANVAS
  ========================================== */

  function resize() {
    const rect = canvas.getBoundingClientRect();

    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);

    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (player) {
      player.x = clamp(player.x, 25, W - 25);
      player.y = clamp(player.y, 25, H - 25);
    }

    createStars();
  }

  function createStars() {
    stars = Array.from({ length: 110 }, () => ({
      x: rand(0, W),
      y: rand(0, H),
      size: rand(.5, 1.8),
      alpha: rand(.15, .75),
      phase: rand(0, 6.28)
    }));
  }

  window.addEventListener("resize", resize);

  window.addEventListener("orientationchange", () => {
    setTimeout(resize, 200);
  });

  /* ==========================================
     TOUCH INPUT
  ========================================== */

  function clearTouchInput() {
    touchDirections.clear();

    document.querySelectorAll(".pad-btn").forEach(btn => {
      btn.classList.remove("pressed");
    });

    ui.dash.classList.remove("pressed");
  }

  document.querySelectorAll(".pad-btn").forEach(btn => {
    const direction = btn.dataset.dir;

    btn.addEventListener("pointerdown", event => {
      if (mode !== "playing") return;

      event.preventDefault();

      touchDirections.add(direction);
      btn.classList.add("pressed");

      try {
        btn.setPointerCapture(event.pointerId);
      } catch (_) {}
    });

    function releaseDirection(event) {
      touchDirections.delete(direction);
      btn.classList.remove("pressed");
    }

    btn.addEventListener("pointerup", releaseDirection);
    btn.addEventListener("pointercancel", releaseDirection);
    btn.addEventListener("lostpointercapture", releaseDirection);
  });

  /* ==========================================
     INPUT DIRECTION
  ========================================== */

  function getInput() {
    let x =
      (touchDirections.has("right") ? 1 : 0) -
      (touchDirections.has("left") ? 1 : 0);

    let y =
      (touchDirections.has("down") ? 1 : 0) -
      (touchDirections.has("up") ? 1 : 0);

    const keyX =
      (
        keys.has("ArrowRight") ||
        keys.has("d") ||
        keys.has("D") ? 1 : 0
      ) -
      (
        keys.has("ArrowLeft") ||
        keys.has("a") ||
        keys.has("A") ? 1 : 0
      );

    const keyY =
      (
        keys.has("ArrowDown") ||
        keys.has("s") ||
        keys.has("S") ? 1 : 0
      ) -
      (
        keys.has("ArrowUp") ||
        keys.has("w") ||
        keys.has("W") ? 1 : 0
      );

    // Keyboard input takes priority when used.

    if (keyX !== 0 || keyY !== 0) {
      x = keyX;
      y = keyY;
    }

    const magnitude = Math.hypot(x, y);

    // Prevent diagonal movement from being faster.

    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }

    return { x, y };
  }

  /* ==========================================
     KEYBOARD
  ========================================== */

  window.addEventListener("keydown", event => {
    const key = event.key;

    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        " "
      ].includes(key)
    ) {
      event.preventDefault();
    }

    keys.add(key);

    if (key === " " && mode === "playing") {
      activateDash();
    }

    if (
      (key === "p" || key === "P" || key === "Escape") &&
      mode === "playing"
    ) {
      pauseRun();
    } else if (
      (key === "p" || key === "P" || key === "Escape") &&
      mode === "paused"
    ) {
      resumeRun();
    }

    if (key === "Enter" && mode === "menu") {
      beginRun();
    }
  });

  window.addEventListener("keyup", event => {
    keys.delete(event.key);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    clearTouchInput();

    if (mode === "playing") {
      pauseRun();
    }
  });

  /* ==========================================
     GAME SETUP
  ========================================== */

  function newPlayer() {
    return {
      x: W / 2,
      y: H / 2,
      vx: 0,
      vy: 0,
      radius: 13,
      invulnerable: 0
    };
  }

  function resetGame() {
    player = newPlayer();

    enemies = [];
    shards = [];
    particles = [];

    score = 0;
    health = 100;
    combo = 1;
    bestCombo = 1;
    sector = 1;

    elapsed = 0;

    spawnTimer = .7;
    shardTimer = 1.8;
    damageTimer = 0;

    dashCooldown = 0;
    dashTime = 0;

    dashDirection = { x: 0, y: -1 };

    screenShake = 0;

    clearTouchInput();
    updateHUD();
  }

  /* ==========================================
     GAME STATES
  ========================================== */

  function setMode(next) {
    mode = next;

    game.dataset.mode = next;

    ui.start.classList.toggle("hidden", next !== "menu");
    ui.pause.classList.toggle("hidden", next !== "paused");
    ui.over.classList.toggle("hidden", next !== "over");

    ui.status.textContent = {
      menu: "AWAITING PILOT",
      playing: "RUN IN PROGRESS",
      paused: "SYSTEM PAUSED",
      over: "SIGNAL LOST"
    }[next];

    if (next !== "playing") {
      clearTouchInput();
      keys.clear();
    }
  }

  function beginRun() {
    if (mode === "playing") return;

    resetGame();

    setMode("playing");

    lastTime = performance.now();

    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function pauseRun() {
    if (mode !== "playing") return;

    setMode("paused");
    cancelAnimationFrame(raf);
  }

  function resumeRun() {
    if (mode !== "paused") return;

    setMode("playing");

    lastTime = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function endRun() {
    setMode("over");

    const newBest = score > records.best;

    if (newBest) {
      records.best = score;

      try {
        localStorage.setItem(
          STORE,
          JSON.stringify(records)
        );
      } catch (_) {}
    }

    ui.finalScore.textContent = pad(score);
    ui.finalCombo.textContent = `x${bestCombo.toFixed(1)}`;
    ui.finalTime.textContent = timeText(elapsed);
    ui.best.textContent = pad(records.best);

    showToast(
      newBest ? "NEW PERSONAL BEST!" : "RUN TERMINATED"
    );

    cancelAnimationFrame(raf);
  }

  /* ==========================================
     DASH
  ========================================== */

  function activateDash() {
    if (mode !== "playing" || dashCooldown > 0) return;

    const input = getInput();

    let dx = input.x;
    let dy = input.y;

    if (Math.hypot(dx, dy) < .1) {
      dx = player.vx;
      dy = player.vy;
    }

    const magnitude = Math.hypot(dx, dy);

    if (magnitude < .1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= magnitude;
      dy /= magnitude;
    }

    dashDirection = { x: dx, y: dy };

    dashTime = .18;
    dashCooldown = 1.5;

    player.invulnerable = .3;

    createBurst(
      player.x,
      player.y,
      "#42d9ff",
      18
    );

    showToast("PHASE DASH");

    updateHUD();
  }

  // Touch dash button

  ui.dash.addEventListener("pointerdown", event => {
    if (mode !== "playing") return;

    event.preventDefault();

    activateDash();

    ui.dash.classList.add("pressed");

    try {
      ui.dash.setPointerCapture(event.pointerId);
    } catch (_) {}
  });

  function releaseDash() {
    ui.dash.classList.remove("pressed");
  }

  ui.dash.addEventListener("pointerup", releaseDash);
  ui.dash.addEventListener("pointercancel", releaseDash);
  ui.dash.addEventListener("lostpointercapture", releaseDash);

  /* ==========================================
     SPAWNING
  ========================================== */

  function spawnEnemy() {
    const side = Math.floor(rand(0, 4));

    let x, y;

    if (side === 0) {
      x = rand(0, W);
      y = -25;
    } else if (side === 1) {
      x = W + 25;
      y = rand(0, H);
    } else if (side === 2) {
      x = rand(0, W);
      y = H + 25;
    } else {
      x = -25;
      y = rand(0, H);
    }

    const elite =
      Math.random() < Math.min(.12 + sector * .015, .4);

    enemies.push({
      x,
      y,
      radius: elite ? 17 : rand(9, 14),
      speed: elite
        ? rand(75, 105)
        : rand(55, 90) + sector * 3,
      elite,
      rotation: rand(0, 6.28),
      color: elite ? "#f05b70" : "#a879ff"
    });
  }

  function spawnShard() {
    shards.push({
      x: rand(35, W - 35),
      y: rand(35, H - 35),
      radius: 7,
      phase: rand(0, 6.28)
    });
  }

  /* ==========================================
     PARTICLES
  ========================================== */

  function createBurst(x, y, color, amount = 12) {
    for (let i = 0; i < amount; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(35, 180);

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(.25, .7),
        maxLife: .7,
        size: rand(1.5, 4),
        color
      });
    }
  }

  /* ==========================================
     COLLISIONS
  ========================================== */

  function damagePlayer(amount) {
    if (player.invulnerable > 0 || damageTimer > 0) return;

    health = Math.max(0, health - amount);

    player.invulnerable = .9;
    damageTimer = .2;

    combo = 1;
    screenShake = 9;

    createBurst(
      player.x,
      player.y,
      "#f05b70",
      20
    );

    updateHUD();

    if (health <= 0) {
      endRun();
    }
  }

  function collectShard(index) {
    const shard = shards[index];

    score += 100 * combo;

    combo = Math.min(9.9, combo + .2);
    bestCombo = Math.max(bestCombo, combo);

    createBurst(
      shard.x,
      shard.y,
      "#42d9ff",
      10
    );

    shards.splice(index, 1);

    updateHUD();
  }

  /* ==========================================
     UPDATE
  ========================================== */

  function update(dt) {
    if (mode !== "playing") return;

    elapsed += dt;

    const input = getInput();

    dashCooldown = Math.max(0, dashCooldown - dt);
    dashTime = Math.max(0, dashTime - dt);

    damageTimer = Math.max(0, damageTimer - dt);

    player.invulnerable = Math.max(
      0,
      player.invulnerable - dt
    );

    screenShake = Math.max(0, screenShake - dt * 30);

    // Movement

    const acceleration = 760;
    const maxSpeed = 310;

    if (dashTime > 0) {
      player.vx = dashDirection.x * 850;
      player.vy = dashDirection.y * 850;
    } else {
      player.vx += input.x * acceleration * dt;
      player.vy += input.y * acceleration * dt;

      player.vx *= Math.pow(.055, dt);
      player.vy *= Math.pow(.055, dt);

      const speed = Math.hypot(player.vx, player.vy);

      if (speed > maxSpeed) {
        player.vx = player.vx / speed * maxSpeed;
        player.vy = player.vy / speed * maxSpeed;
      }
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = clamp(player.x, 18, W - 18);
    player.y = clamp(player.y, 18, H - 18);

    // Sector progression

    const nextSector = 1 + Math.floor(elapsed / 25);

    if (nextSector !== sector) {
      sector = nextSector;

      showToast(
        `SECTOR ${String(sector).padStart(2, "0")}`
      );

      updateHUD();
    }

    // Spawn enemies

    spawnTimer -= dt;

    if (spawnTimer <= 0) {
      spawnEnemy();

      spawnTimer = Math.max(
        .25,
        1.2 - sector * .075
      );
    }

    // Spawn shards

    shardTimer -= dt;

    if (shardTimer <= 0) {
      spawnShard();
      shardTimer = rand(2.5, 4.2);
    }

    // Update enemies

    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];

      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;

      const distance = Math.hypot(dx, dy) || 1;

      enemy.x += dx / distance * enemy.speed * dt;
      enemy.y += dy / distance * enemy.speed * dt;

      enemy.rotation += dt * 1.5;

      if (
        distance <
        enemy.radius + player.radius
      ) {
        if (dashTime > 0) {
          score += enemy.elite ? 250 : 100;

          createBurst(
            enemy.x,
            enemy.y,
            enemy.color,
            16
          );

          enemies.splice(i, 1);
          updateHUD();
        } else {
          damagePlayer(enemy.elite ? 18 : 10);

          if (mode !== "playing") return;

          enemy.x -= dx / distance * 24;
          enemy.y -= dy / distance * 24;
        }
      }
    }

    // Collect shards

    for (let i = shards.length - 1; i >= 0; i--) {
      const shard = shards[i];

      const distance = Math.hypot(
        player.x - shard.x,
        player.y - shard.y
      );

      if (
        distance <
        player.radius + shard.radius + 3
      ) {
        collectShard(i);
      }
    }

    // Particles

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.vx *= Math.pow(.12, dt);
      p.vy *= Math.pow(.12, dt);

      p.life -= dt;

      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }

    // Passive score

    score += dt * 5;

    updateHUD();
  }

  /* ==========================================
     DRAWING
  ========================================== */

  function drawBackground(time) {
    ctx.fillStyle = "#070d1b";
    ctx.fillRect(0, 0, W, H);

    // Grid

    ctx.save();
    ctx.strokeStyle = "#52749a12";
    ctx.lineWidth = 1;

    const grid = 42;
    const offset = (time * 8) % grid;

    for (let x = -grid; x < W + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x + offset, H);
      ctx.stroke();
    }

    for (let y = -grid; y < H + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y + offset);
      ctx.lineTo(W, y + offset);
      ctx.stroke();
    }

    ctx.restore();

    // Stars

    for (const star of stars) {
      const pulse =
        .55 + Math.sin(time * 1.5 + star.phase) * .3;

      ctx.globalAlpha = star.alpha * pulse;
      ctx.fillStyle = "#b7d8ff";

      ctx.fillRect(
        star.x,
        star.y,
        star.size,
        star.size
      );
    }

    ctx.globalAlpha = 1;
  }

  function drawPlayer(time) {
    if (!player) return;

    const angle = Math.atan2(
      player.vy,
      player.vx
    );

    ctx.save();

    ctx.translate(player.x, player.y);

    if (Math.hypot(player.vx, player.vy) > 8) {
      ctx.rotate(angle + Math.PI / 2);
    }

    const flashing =
      player.invulnerable > 0 &&
      Math.floor(time * 14) % 2 === 0;

    if (flashing) ctx.globalAlpha = .35;

    // Engine glow

    ctx.shadowBlur = 22;
    ctx.shadowColor = "#42d9ff";

    ctx.fillStyle = "#42d9ff";

    ctx.beginPath();
    ctx.moveTo(0, -23);
    ctx.lineTo(14, 14);
    ctx.lineTo(0, 8);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.fillStyle = "#eafaff";

    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(5, 7);
    ctx.lineTo(-5, 7);
    ctx.closePath();
    ctx.fill();

    if (dashTime > 0) {
      ctx.strokeStyle = "#42d9ff";
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawEnemies(time) {
    for (const enemy of enemies) {
      ctx.save();

      ctx.translate(enemy.x, enemy.y);
      ctx.rotate(enemy.rotation);

      ctx.shadowBlur = enemy.elite ? 24 : 15;
      ctx.shadowColor = enemy.color;

      ctx.strokeStyle = enemy.color;
      ctx.fillStyle = enemy.elite ? "#451b2a" : "#211a3d";
      ctx.lineWidth = 2;

      ctx.beginPath();

      const sides = enemy.elite ? 6 : 4;

      for (let i = 0; i < sides; i++) {
        const angle =
          i / sides * Math.PI * 2 - Math.PI / 4;

        const x = Math.cos(angle) * enemy.radius;
        const y = Math.sin(angle) * enemy.radius;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawShards(time) {
    for (const shard of shards) {
      const pulse =
        1 + Math.sin(time * 4 + shard.phase) * .15;

      ctx.save();

      ctx.translate(shard.x, shard.y);
      ctx.rotate(time * 1.5 + shard.phase);
      ctx.scale(pulse, pulse);

      ctx.shadowBlur = 20;
      ctx.shadowColor = "#42d9ff";

      ctx.fillStyle = "#42d9ff";

      ctx.beginPath();
      ctx.moveTo(0, -shard.radius);
      ctx.lineTo(shard.radius, 0);
      ctx.lineTo(0, shard.radius);
      ctx.lineTo(-shard.radius, 0);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(
        p.life / p.maxLife,
        0,
        1
      );

      ctx.fillStyle = p.color;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  function render(time) {
    ctx.save();

    if (screenShake > 0) {
      ctx.translate(
        rand(-screenShake, screenShake),
        rand(-screenShake, screenShake)
      );
    }

    drawBackground(time);
    drawShards(time);
    drawEnemies(time);
    drawParticles();
    drawPlayer(time);

    ctx.restore();
  }

  /* ==========================================
     HUD
  ========================================== */

  function updateHUD() {
    ui.score.textContent = pad(score);
    ui.combo.textContent = `x${combo.toFixed(1)}`;
    ui.sector.textContent = String(sector).padStart(2, "0");

    ui.best.textContent = pad(
      Math.max(records.best, score)
    );

    ui.healthText.textContent = `${Math.ceil(health)}%`;
    ui.health.style.width = `${health}%`;

    if (health < 30) {
      ui.health.style.background =
        "linear-gradient(90deg,#f05b70,#ff8794)";
    } else {
      ui.health.style.background =
        "linear-gradient(90deg,#36d9a0,#7ef0c5)";
    }

    // Dash cooldown display

    if (dashCooldown > 0) {
      ui.dashLabel.textContent =
        `${dashCooldown.toFixed(1)}s`;

      ui.dash.classList.add("cooldown");
    } else {
      ui.dashLabel.textContent = "READY";

      ui.dash.classList.remove("cooldown");
    }
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      ui.toast.classList.remove("show");
    }, 1500);
  }

  /* ==========================================
     MAIN LOOP
  ========================================== */

  function loop(now) {
    if (mode !== "playing") return;

    const dt = Math.min(
      (now - lastTime) / 1000,
      .033
    );

    lastTime = now;

    update(dt);
    render(now / 1000);

    if (mode === "playing") {
      raf = requestAnimationFrame(loop);
    }
  }

  /* ==========================================
     BUTTONS
  ========================================== */

  $("startBtn").addEventListener("click", beginRun);
  $("retryBtn").addEventListener("click", beginRun);

  $("resumeBtn").addEventListener("click", resumeRun);

  $("quitBtn").addEventListener("click", () => {
    cancelAnimationFrame(raf);
    setMode("menu");
    render(performance.now() / 1000);
  });

  /* ==========================================
     INITIALIZE
  ========================================== */

  resize();

  player = newPlayer();

  ui.best.textContent = pad(records.best);

  setMode("menu");

  render(0);

})();
