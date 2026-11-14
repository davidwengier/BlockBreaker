const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const ROWS = 6;
const COLS = 15;
const BLOCK_GAP = 8;
const BLOCK_TOP = 50;
const BLOCK_AREA_H = 250;
const THROUGH_PATHS = 2;
const HITS_PER_LEVEL = 6;
const SHRINK_AFTER_LEVEL = 5; // later levels use more, smaller shapes
const SPEED_STEP = 0.1; // ball speed increase per level
const CONTINUE_DELAY = 0.75; // seconds before the level-complete screen accepts input
const FIREWORK_COLORS = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff'];
const HITS_PER_COLOR = 5; // each colour covers this many hits, cycling after the last
const BLOCK_COLORS = ['#9ccc65', '#ffee58', '#ffb74d', '#ef5350', '#ba68c8', '#64b5f6'];
// Clockwise outlines in cell units; the label stays inside a solid part after rotation.
const BLOCK_SHAPES = [
  { points: [[0, 0], [1, 0], [1, 2], [2, 2], [2, 3], [0, 3]], label: [0.5, 1.5] }, // L
  { points: [[0, 0], [3, 0], [3, 1], [2, 1], [2, 2], [1, 2], [1, 1], [0, 1]], label: [1.5, 0.5] }, // T
  { points: [[0, 0], [2, 0], [2, 1], [3, 1], [3, 2], [1, 2], [1, 1], [0, 1]], label: [1.5, 1] }, // zigzag
  { points: [[0, 0], [3, 0], [3, 1], [0, 1]], label: [1.5, 0.5] }, // bar
  { points: [[0, 0], [2, 0], [2, 2], [0, 2]], label: [1, 1] }, // square
];

const PADDLE_W = 90;
const PADDLE_H = 12;
const PADDLE_SPEED = 480; // px/sec
const BALL_R = 7;
const BALL_SPEED = 320; // px/sec

// Floating pickups change the ball's colour and apply an effect without a bounce.
// Only one is active at a time; it lasts until the next pickup replaces it or a life is lost.
const POWERUPS_PER_LEVEL = 3;
const POWERUP_REFILL_SECONDS = 10; // how often a missing pickup is replaced during play
const POWERUP_R = 9;
const POWERUPS = {
  multi:   { color: '#ff5722', label: 'Multi-ball: a new ball splits off' },
  giant:   { color: '#66bb6a', label: 'Giant ball' },
  wide:    { color: '#ab47bc', label: 'Wide paddle' },
  double:  { color: '#ec407a', label: 'Double strength: hits count twice' },
  heart:   { color: '#ffd700', label: 'Extra life!' },
  // Negative powerups
  ice:     { color: '#4dd0e1', label: 'Ice: slower ball', bad: true },
  shrink:  { color: '#8d6e63', label: 'Shrunk paddle', bad: true },
  fast:    { color: '#d50000', label: 'Fast ball', bad: true },
  reverse: { color: '#aeea00', label: 'Reversed controls', bad: true },
  ghost:   { color: '#78909c', label: 'Ghost: ball is nearly invisible', bad: true },
};

const paddle = { x: (W - PADDLE_W) / 2, y: H - 30 };

// Fill the side legend from the powerup table so the two never drift apart
const legend = document.getElementById('legend');
function addLegendItem(color, text, { bad = false, square = false } = {}) {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = square ? 'dot square' : 'dot';
  dot.style.background = square ? color : 'transparent';
  dot.style.borderColor = color;
  if (bad) li.className = 'bad';
  li.append(dot, text);
  legend.append(li);
}
for (let i = 0; i < BLOCK_COLORS.length; i++) {
  const max = (i + 1) * HITS_PER_COLOR;
  addLegendItem(blockColor(max), `${max - HITS_PER_COLOR + 1}-${max} hits`, { square: true });
}
for (const p of Object.values(POWERUPS)) addLegendItem(p.color, p.label, { bad: p.bad });
// Every ball in play; a life is only lost once all of them have fallen off the bottom.
let balls = [];
let launched = false;
let levelStartScore = 0;
let refillTimer = 0; // seconds of play since the last pickup refill check
let celebration = null; // fireworks and score summary while state is 'cleared'
let blocks, pickups, score, lives, level, state; // state: 'playing' | 'cleared' | 'lost'
let active = null; // { type } for the current powerup
const keys = {};

const ballRadius = () => (active?.type === 'giant' ? BALL_R * 2 : BALL_R);
const paddleWidth = () => {
  if (active?.type === 'wide') return PADDLE_W * 1.6;
  if (active?.type === 'shrink') return PADDLE_W * 0.6;
  return PADDLE_W;
};
const reversed = () => active?.type === 'reverse';

function ballSpeed() {
  const base = BALL_SPEED * (1 + SPEED_STEP * (level - 1));
  if (active?.type === 'ice') return base * 0.6;
  if (active?.type === 'fast') return base * 1.5;
  return base;
}

// Keep each ball's direction but apply the current speed (after powerups start/end)
function applySpeed() {
  for (const ball of balls) {
    const current = Math.hypot(ball.vx, ball.vy);
    if (current === 0) continue;
    const k = ballSpeed() / current;
    ball.vx *= k;
    ball.vy *= k;
  }
}

function setPowerup(type) {
  const centre = paddle.x + paddleWidth() / 2;
  active = type ? { type } : null;
  // Widen/narrow around the centre so the paddle doesn't jump
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), centre - paddleWidth() / 2));
  applySpeed();
}

function blockColor(hits) {
  const tier = Math.max(0, Math.ceil(hits / HITS_PER_COLOR) - 1);
  return BLOCK_COLORS[tier % BLOCK_COLORS.length];
}

function rotatePoint([x, y], turns) {
  for (let i = 0; i < turns; i++) [x, y] = [-y, x];
  return { x, y };
}

function createBlock(shape, turns, x, y, size, hits, inset = 0) {
  const rotated = shape.points.map(p => rotatePoint(p, turns));
  const minX = Math.min(...rotated.map(p => p.x));
  const minY = Math.min(...rotated.map(p => p.y));
  const position = p => ({ x: x + (p.x - minX) * size, y: y + (p.y - minY) * size });
  const outline = rotated.map(position);
  // Inset the outline, not the whole shape, so interlocking arms keep a uniform gutter.
  const points = outline.map((point, i) => {
    const prev = outline[(i + outline.length - 1) % outline.length];
    const next = outline[(i + 1) % outline.length];
    return {
      x: point.x - (Math.sign(point.y - prev.y) + Math.sign(next.y - point.y)) * inset,
      y: point.y + (Math.sign(point.x - prev.x) + Math.sign(next.x - point.x)) * inset,
    };
  });
  const corners = points.map((point, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const incoming = { x: Math.sign(point.x - prev.x), y: Math.sign(point.y - prev.y) };
    const outgoing = { x: Math.sign(next.x - point.x), y: Math.sign(next.y - point.y) };
    const radius = (size - inset * 2) * 0.38;
    return {
      point, incoming, outgoing, radius,
      start: { x: point.x - incoming.x * radius, y: point.y - incoming.y * radius },
      end: { x: point.x + outgoing.x * radius, y: point.y + outgoing.y * radius },
      center: {
        x: point.x + (outgoing.x - incoming.x) * radius,
        y: point.y + (outgoing.y - incoming.y) * radius,
      },
    };
  });
  const path = new Path2D();
  path.moveTo(corners[0].end.x, corners[0].end.y);
  const edges = corners.map((corner, i) => {
    const prev = corners[(i + corners.length - 1) % corners.length];
    return { start: prev.end, end: corner.start, normal: { x: corner.incoming.y, y: -corner.incoming.x } };
  });
  for (let i = 1; i <= corners.length; i++) {
    const corner = corners[i % corners.length];
    path.lineTo(corner.start.x, corner.start.y);
    path.arcTo(corner.point.x, corner.point.y, corner.end.x, corner.end.y, corner.radius);
  }
  path.closePath();
  return {
    path, corners, edges, hits, size: size - inset * 2,
    label: position(rotatePoint(shape.label, turns)),
    bounds: {
      left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
    },
  };
}

function blockLayouts() {
  const layouts = [];
  for (const shape of BLOCK_SHAPES) {
    for (let turns = 0; turns < 4; turns++) {
      const template = createBlock(shape, turns, 0, 0, 1, 1);
      const cells = [];
      for (let y = 0; y < template.bounds.bottom; y++) {
        for (let x = 0; x < template.bounds.right; x++) {
          if (ctx.isPointInPath(template.path, x + 0.5, y + 0.5)) cells.push({ x, y });
        }
      }
      layouts.push({ shape, turns, cells });
    }
  }
  return layouts;
}

function findBlockPlacement(layouts, occupied, column, row) {
  const offset = Math.floor(Math.random() * layouts.length);
  // Prefer Ls, Ts and zigzags; bars and squares fill the remaining holes.
  for (const irregular of [true, false]) {
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[(i + offset) % layouts.length];
      if ((layout.shape.points.length > 4) !== irregular) continue;
      for (const anchor of layout.cells) {
        const x = column - anchor.x;
        const y = row - anchor.y;
        if (layout.cells.every(cell => {
          const c = x + cell.x;
          const r = y + cell.y;
          return r >= 0 && r < occupied.length && c >= 0 && c < occupied[0].length && !occupied[r][c];
        })) return { layout, x, y };
      }
    }
  }
  return null;
}

function buildBlocks() {
  const cols = level > SHRINK_AFTER_LEVEL ? COLS * 2 : COLS;
  const size = Math.min((W - BLOCK_GAP * 2) / cols, BLOCK_AREA_H / ROWS);
  const left = (W - cols * size) / 2;
  const occupied = Array.from({ length: ROWS }, () => Array(cols).fill(false));
  const layouts = blockLayouts();
  blocks = [];
  pickups = [];
  refillTimer = 0;
  for (let i = 0; i < POWERUPS_PER_LEVEL; i++) {
    // Spread the passages out; keep two through the field and the third open to its pickup.
    const column = Math.floor((i + 1) * cols / (POWERUPS_PER_LEVEL + 1)) + Math.floor(Math.random() * 3) - 1;
    const row = Math.floor(Math.random() * ROWS);
    for (let r = i < THROUGH_PATHS ? 0 : row; r < ROWS; r++) occupied[r][column] = true;
    pickups.push({
      x: left + (column + 0.5) * size,
      y: BLOCK_TOP + (row + 0.5) * size,
      type: randomPowerupType(),
    });
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (occupied[r][c]) continue;
      const placement = findBlockPlacement(layouts, occupied, c, r);
      if (!placement) continue;
      const { layout, x, y } = placement;
      for (const cell of layout.cells) occupied[y + cell.y][x + cell.x] = true;
      const hits = 1 + Math.floor(Math.random() * HITS_PER_LEVEL * level);
      blocks.push(createBlock(layout.shape, layout.turns, left + x * size,
        BLOCK_TOP + y * size, size, hits, BLOCK_GAP / 2));
    }
  }
}

function randomPowerupType() {
  const types = Object.keys(POWERUPS);
  return types[Math.floor(Math.random() * types.length)];
}

// Is there room for a pickup here, with a straight run up from below so a ball can reach it?
function canPlacePickup(x, y) {
  const probe = { x, y };
  const radius = POWERUP_R + BALL_R;
  for (; probe.y < paddle.y - BALL_R * 4; probe.y += BALL_R) {
    if (blocks.some(b => b.hits > 0 && blockContact(b, probe.y === y ? radius : BALL_R, probe))) return false;
  }
  const crowded = item => Math.hypot(item.x - x, item.y - y) < POWERUP_R * 4 + ballRadius();
  return !pickups.some(crowded) && !balls.some(crowded);
}

// Add one pickup at a random reachable spot; gives up quietly if the board has no room.
function spawnPickup() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = POWERUP_R * 2 + Math.random() * (W - POWERUP_R * 4);
    const y = BLOCK_TOP + POWERUP_R + Math.random() * (paddle.y - 100 - BLOCK_TOP);
    if (!canPlacePickup(x, y)) continue;
    pickups.push({ x, y, type: randomPowerupType() });
    return true;
  }
  return false;
}

function damageBlock(b, damage = 1) {
  if (b.hits <= 0) return;
  b.hits = Math.max(0, b.hits - damage);
  if (b.hits > 0) return;
  score += 10;
}

// Split a new ball off the collecting one, turned 45° but kept heading mostly up or down.
function spawnBall(from) {
  let angle = Math.PI / 4;
  const turned = a => ({
    vx: from.vx * Math.cos(a) - from.vy * Math.sin(a),
    vy: from.vx * Math.sin(a) + from.vy * Math.cos(a),
  });
  let velocity = turned(angle);
  if (Math.abs(velocity.vy) < Math.abs(velocity.vx)) velocity = turned(-angle);
  balls.push({ x: from.x, y: from.y, ...velocity });
}

function collectPowerups(ball) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pickup = pickups[i];
    if (Math.hypot(ball.x - pickup.x, ball.y - pickup.y) > ballRadius() + POWERUP_R) continue;
    pickups.splice(i, 1);
    if (pickup.type === 'heart') lives++;
    setPowerup(pickup.type);
    if (pickup.type === 'multi') spawnBall(ball);
  }
}

function newGame() {
  score = 0;
  levelStartScore = 0;
  lives = 3;
  level = 1;
  state = 'playing';
  celebration = null;
  buildBlocks();
  setPowerup(null);
  resetBall();
}

// Level-complete celebration: rockets rise from the bottom and burst into falling sparks.
function completeLevel() {
  state = 'cleared';
  balls = [];
  celebration = { levelScore: score - levelStartScore, time: 0, nextRocket: 0, rockets: [], sparks: [] };
}

function nextLevel() {
  level++;
  levelStartScore = score;
  state = 'playing';
  celebration = null;
  buildBlocks();
  resetBall();
}

function updateCelebration(dt) {
  const c = celebration;
  c.time += dt;
  if ((c.nextRocket -= dt) <= 0) {
    c.nextRocket = 0.25 + Math.random() * 0.35;
    c.rockets.push({
      x: W * (0.15 + Math.random() * 0.7), y: H,
      vy: -(380 + Math.random() * 120),
      burstY: H * (0.15 + Math.random() * 0.35),
      color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
    });
  }
  for (const rocket of c.rockets) {
    rocket.y += rocket.vy * dt;
    if (rocket.y > rocket.burstY) continue;
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      const life = 1 + Math.random() * 0.6;
      c.sparks.push({
        x: rocket.x, y: rocket.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life, maxLife: life, color: rocket.color,
      });
    }
  }
  c.rockets = c.rockets.filter(rocket => rocket.y > rocket.burstY);
  for (const spark of c.sparks) {
    spark.vy += 160 * dt; // gravity
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.life -= dt;
  }
  c.sparks = c.sparks.filter(spark => spark.life > 0);
}

function resetBall() {
  launched = false;
  balls = [{ x: 0, y: 0, vx: 0, vy: 0 }];
  stickBallToPaddle();
}

function stickBallToPaddle() {
  balls[0].x = paddle.x + paddleWidth() / 2;
  balls[0].y = paddle.y - ballRadius();
}

function launch() {
  if (state === 'cleared') {
    // A short pause stops a click or Space press at the moment of clearing from skipping the screen.
    if (celebration.time >= CONTINUE_DELAY) nextLevel();
    return;
  }
  if (state !== 'playing') {
    newGame();
    return;
  }
  if (launched) return;
  launched = true;
  // Slight random angle, always upward
  const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.8;
  balls[0].vx = Math.cos(angle) * ballSpeed();
  balls[0].vy = Math.sin(angle) * ballSpeed();
}

function movePaddleTo(x) {
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), x - paddleWidth() / 2));
}

function pointerX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (W / rect.width);
  return reversed() ? W - x : x;
}

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    launch();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
// Pointer lock keeps the cursor from leaving the game; while locked we move by deltas
const locked = () => document.pointerLockElement === canvas;

canvas.addEventListener('pointermove', e => {
  if (locked()) {
    const rect = canvas.getBoundingClientRect();
    movePaddleTo(paddle.x + paddleWidth() / 2 + e.movementX * (W / rect.width) * (reversed() ? -1 : 1));
  } else if (e.pointerType !== 'mouse') {
    movePaddleTo(pointerX(e.clientX));
  }
});
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') {
    if (!locked()) canvas.requestPointerLock(); // Esc releases it
  } else {
    movePaddleTo(pointerX(e.clientX));
  }
  launch();
});

function update(dt) {
  if (state === 'cleared') {
    updateCelebration(dt);
    return;
  }
  if (state !== 'playing') return;

  const dir = ((keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0)) * (reversed() ? -1 : 1);
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), paddle.x + dir * PADDLE_SPEED * dt));

  if (!launched) {
    stickBallToPaddle();
    return;
  }

  // Small steps stop a fast ball skipping thin arms or hitting a surviving block repeatedly.
  const fastest = Math.max(...balls.map(ball => Math.hypot(ball.vx, ball.vy)));
  const steps = Math.max(1, Math.ceil(fastest * dt / (BALL_R / 2)));
  for (let i = 0; i < steps; i++) {
    // Copy the list so a ball split off mid-step starts moving on the next step.
    for (const ball of [...balls]) moveBall(ball, dt / steps);
  }
  balls = balls.filter(ball => ball.y - ballRadius() <= H);

  // Every few seconds of play, top the board back up to its usual number of pickups.
  if ((refillTimer += dt) >= POWERUP_REFILL_SECONDS) {
    refillTimer -= POWERUP_REFILL_SECONDS;
    if (pickups.length < POWERUPS_PER_LEVEL) spawnPickup();
  }

  if (blocks.every(b => b.hits === 0)) {
    completeLevel();
  } else if (balls.length === 0) {
    lives--;
    setPowerup(null); // the new ball starts without the old powerup
    if (lives <= 0) state = 'lost';
    else resetBall();
  }
}

function blockContact(b, radius, ball) {
  const bounds = b.bounds;
  if (ball.x + radius < bounds.left || ball.x - radius > bounds.right ||
      ball.y + radius < bounds.top || ball.y - radius > bounds.bottom) return null;

  let nearest = null;
  function consider(x, y, nx, ny) {
    const distanceSquared = (ball.x - x) ** 2 + (ball.y - y) ** 2;
    if (!nearest || distanceSquared < nearest.distanceSquared) nearest = { x, y, nx, ny, distanceSquared };
  }

  for (const edge of b.edges) {
    const dx = edge.end.x - edge.start.x;
    const dy = edge.end.y - edge.start.y;
    const t = Math.max(0, Math.min(1, ((ball.x - edge.start.x) * dx + (ball.y - edge.start.y) * dy) / (dx * dx + dy * dy)));
    consider(edge.start.x + t * dx, edge.start.y + t * dy, edge.normal.x, edge.normal.y);
  }
  for (const corner of b.corners) {
    const dx = ball.x - corner.center.x;
    const dy = ball.y - corner.center.y;
    const distance = Math.hypot(dx, dy);
    // Only the quarter-circle between the two tangents belongs to this corner.
    if (distance === 0 || dx * corner.outgoing.x + dy * corner.outgoing.y > 0 ||
        dx * corner.incoming.x + dy * corner.incoming.y < 0) continue;
    const convex = corner.incoming.x * corner.outgoing.y - corner.incoming.y * corner.outgoing.x > 0;
    const direction = convex ? 1 : -1;
    consider(corner.center.x + dx / distance * corner.radius,
      corner.center.y + dy / distance * corner.radius, direction * dx / distance, direction * dy / distance);
  }

  const inside = ctx.isPointInPath(b.path, ball.x, ball.y);
  const distance = Math.sqrt(nearest.distanceSquared);
  if (!inside && distance > radius) return null;
  const direction = inside ? -1 : 1;
  return {
    nx: distance === 0 ? nearest.nx : direction * (ball.x - nearest.x) / distance,
    ny: distance === 0 ? nearest.ny : direction * (ball.y - nearest.y) / distance,
    depth: radius + (inside ? distance : -distance),
  };
}

function moveBall(ball, dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  collectPowerups(ball);
  const r = ballRadius();

  // Walls and ceiling
  if (ball.x < r) { ball.x = r; ball.vx = Math.abs(ball.vx); }
  if (ball.x > W - r) { ball.x = W - r; ball.vx = -Math.abs(ball.vx); }
  if (ball.y < r) { ball.y = r; ball.vy = Math.abs(ball.vy); }

  // Paddle: the hit position controls the bounce angle
  const pw = paddleWidth();
  if (ball.vy > 0 &&
      ball.y + r >= paddle.y && ball.y - r <= paddle.y + PADDLE_H &&
      ball.x >= paddle.x - r && ball.x <= paddle.x + pw + r) {
    const hit = (ball.x - (paddle.x + pw / 2)) / (pw / 2); // -1..1
    const angle = hit * (Math.PI / 3); // up to 60° from vertical
    ball.vx = Math.sin(angle) * ballSpeed();
    ball.vy = -Math.cos(angle) * ballSpeed();
    ball.y = paddle.y - r;
  }

  // Blocks
  for (const b of blocks) {
    if (b.hits <= 0) continue;
    const contact = blockContact(b, r, ball);
    if (!contact) continue;
    const incoming = ball.vx * contact.nx + ball.vy * contact.ny;
    ball.x += contact.nx * (contact.depth + 0.01);
    ball.y += contact.ny * (contact.depth + 0.01);
    if (incoming >= 0) continue;

    damageBlock(b, active?.type === 'double' ? 2 : 1);

    // Reflect around the actual surface normal, including curved and inside corners.
    const dot = ball.vx * contact.nx + ball.vy * contact.ny;
    ball.vx -= 2 * dot * contact.nx;
    ball.vy -= 2 * dot * contact.ny;
    break;
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  for (const b of blocks) {
    if (b.hits <= 0) continue;
    ctx.fillStyle = blockColor(b.hits);
    ctx.fill(b.path);
    ctx.fillStyle = '#17212b';
    ctx.font = `bold ${Math.max(11, Math.floor(b.size * 0.45))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.hits, b.label.x, b.label.y, b.size * 0.85);
  }
  for (const pickup of pickups) {
    const powerup = POWERUPS[pickup.type];
    ctx.strokeStyle = powerup.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pickup.x, pickup.y, POWERUP_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = powerup.color;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(powerup.bad ? '-' : '+', pickup.x, pickup.y);
  }
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = active?.type === 'wide' ? POWERUPS.wide.color : '#ecf0f1';
  ctx.fillRect(paddle.x, paddle.y, paddleWidth(), PADDLE_H);

  ctx.fillStyle = active ? POWERUPS[active.type].color : '#ecf0f1';
  ctx.globalAlpha = active?.type === 'ghost' ? 0.15 : 1;
  for (const ball of balls) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ballRadius(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#ecf0f1';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 10, 24);
  ctx.textAlign = 'center';
  ctx.fillText(`Level: ${level}`, W / 2, 24);
  ctx.textAlign = 'right';
  ctx.fillText(`Lives: ${lives}`, W - 10, 24);

  if (active) {
    ctx.fillStyle = POWERUPS[active.type].color;
    ctx.fillText(POWERUPS[active.type].label, W - 10, H - 6);
  }

  ctx.fillStyle = '#ecf0f1';
  ctx.textAlign = 'center';
  if (state === 'cleared') {
    drawCelebration();
  } else if (state === 'playing' && !launched) {
    ctx.fillText('Press Space or click to launch', W / 2, paddle.y - 60);
  } else if (state !== 'playing') {
    ctx.font = '32px sans-serif';
    ctx.fillText('Game over', W / 2, H / 2);
    ctx.font = '16px sans-serif';
    ctx.fillText('Press Space or click to play again', W / 2, H / 2 + 30);
  }
}

function drawCelebration() {
  const c = celebration;
  ctx.fillStyle = 'rgba(10, 12, 24, 0.55)';
  ctx.fillRect(0, 0, W, H);

  for (const rocket of c.rockets) {
    ctx.fillStyle = rocket.color;
    ctx.fillRect(rocket.x - 1.5, rocket.y, 3, 10);
  }
  for (const spark of c.sparks) {
    ctx.globalAlpha = spark.life / spark.maxLife;
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'center';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(`Level ${level} complete!`, W / 2, H / 2 - 30);
  ctx.fillStyle = '#ecf0f1';
  ctx.font = '20px sans-serif';
  ctx.fillText(`This level: +${c.levelScore}`, W / 2, H / 2 + 10);
  ctx.fillText(`Total score: ${score}`, W / 2, H / 2 + 40);
  if (c.time >= CONTINUE_DELAY) {
    ctx.font = '16px sans-serif';
    ctx.fillText(`Press Space or click for level ${level + 1}`, W / 2, H / 2 + 85);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // clamp after tab switches
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);
