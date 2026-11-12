const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const ROWS = 5;
const COLS = 10;
const BLOCK_GAP = 4;
const BLOCK_TOP = 50;
const BLOCK_H = 20;
const SHRINK_AFTER_LEVEL = 5; // later levels use blocks half as wide
const SPEED_STEP = 0.1; // ball speed increase per level
const ROW_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'];

const PADDLE_W = 90;
const PADDLE_H = 12;
const PADDLE_SPEED = 480; // px/sec
const BALL_R = 7;
const BALL_SPEED = 320; // px/sec

// Hidden in random blocks; hitting one turns the ball this colour and applies the effect.
// Only one is active at a time, and it ends on timeout, a lost life or a new level.
const POWERUPS_PER_LEVEL = 3;
const POWERUPS = {
  fire:   { color: '#ff5722', duration: 8,  label: 'Fireball: smashes through blocks' },
  ice:    { color: '#4dd0e1', duration: 10, label: 'Ice: slower ball' },
  giant:  { color: '#66bb6a', duration: 10, label: 'Giant ball' },
  wide:   { color: '#ab47bc', duration: 12, label: 'Wide paddle' },
  bomb:   { color: '#ec407a', duration: 8,  label: 'Bomb: blocks explode' },
  heart:  { color: '#ffd700', duration: 3,  label: 'Extra life!' },
};

const paddle = { x: (W - PADDLE_W) / 2, y: H - 30 };

// Fill the side legend from the powerup table so the two never drift apart
for (const p of Object.values(POWERUPS)) {
  const li = document.createElement('li');
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = p.color;
  li.append(dot, p.label);
  document.getElementById('legend').append(li);
}
const ball = { x: 0, y: 0, vx: 0, vy: 0, launched: false };
let blocks, score, lives, level, state; // state: 'playing' | 'lost'
let blockW = 0; // width of blocks in the current level
let active = null; // { type, timeLeft } for the current powerup
const keys = {};

const ballRadius = () => (active?.type === 'giant' ? BALL_R * 2 : BALL_R);
const paddleWidth = () => (active?.type === 'wide' ? PADDLE_W * 1.6 : PADDLE_W);

function ballSpeed() {
  const base = BALL_SPEED * (1 + SPEED_STEP * (level - 1));
  return active?.type === 'ice' ? base * 0.6 : base;
}

// Keep the ball's direction but apply the current speed (after powerups start/end)
function applySpeed() {
  const current = Math.hypot(ball.vx, ball.vy);
  if (current === 0) return;
  const k = ballSpeed() / current;
  ball.vx *= k;
  ball.vy *= k;
}

function setPowerup(type) {
  const centre = paddle.x + paddleWidth() / 2;
  active = type ? { type, timeLeft: POWERUPS[type].duration } : null;
  // Widen/narrow around the centre so the paddle doesn't jump
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), centre - paddleWidth() / 2));
  applySpeed();
}

function buildBlocks() {
  // Past the shrink level, blocks are half as wide, so twice as many fit per row
  const shrunk = level > SHRINK_AFTER_LEVEL;
  const cols = shrunk ? COLS * 2 : COLS;
  blockW = (W - BLOCK_GAP * (COLS + 1)) / COLS / (shrunk ? 2 : 1);
  const gap = (W - cols * blockW) / (cols + 1);
  blocks = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      blocks.push({
        x: gap + c * (blockW + gap),
        y: BLOCK_TOP + r * (BLOCK_H + BLOCK_GAP),
        color: ROW_COLORS[r],
        alive: true,
        powerup: null,
      });
    }
  }

  // Sprinkle powerups into random distinct blocks
  const types = Object.keys(POWERUPS);
  const picks = [...blocks].sort(() => Math.random() - 0.5).slice(0, POWERUPS_PER_LEVEL);
  for (const b of picks) b.powerup = types[Math.floor(Math.random() * types.length)];
}

function destroyBlock(b) {
  b.alive = false;
  score += 10;
  if (b.powerup) {
    if (b.powerup === 'heart') lives++;
    setPowerup(b.powerup);
  }
}

function newGame() {
  score = 0;
  lives = 3;
  level = 1;
  state = 'playing';
  buildBlocks();
  resetBall();
}

function resetBall() {
  ball.launched = false;
  ball.vx = ball.vy = 0;
  setPowerup(null);
  stickBallToPaddle();
}

function stickBallToPaddle() {
  ball.x = paddle.x + paddleWidth() / 2;
  ball.y = paddle.y - ballRadius();
}

function launch() {
  if (state !== 'playing') {
    newGame();
    return;
  }
  if (ball.launched) return;
  ball.launched = true;
  // Slight random angle, always upward
  const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 0.8;
  ball.vx = Math.cos(angle) * ballSpeed();
  ball.vy = Math.sin(angle) * ballSpeed();
}

function movePaddleTo(x) {
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), x - paddleWidth() / 2));
}

function pointerX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) * (W / rect.width);
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
    movePaddleTo(paddle.x + paddleWidth() / 2 + e.movementX * (W / rect.width));
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
  if (state !== 'playing') return;

  const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  paddle.x = Math.max(0, Math.min(W - paddleWidth(), paddle.x + dir * PADDLE_SPEED * dt));

  if (!ball.launched) {
    stickBallToPaddle();
    return;
  }

  if (active && (active.timeLeft -= dt) <= 0) setPowerup(null);
  const r = ballRadius();

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

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
    if (!b.alive) continue;
    // Closest point on the block to the ball center
    const cx = Math.max(b.x, Math.min(ball.x, b.x + blockW));
    const cy = Math.max(b.y, Math.min(ball.y, b.y + BLOCK_H));
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    if (dx * dx + dy * dy > r * r) continue;

    destroyBlock(b);

    if (active?.type === 'bomb') {
      // Also destroy blocks within roughly one block of the one hit
      for (const n of blocks) {
        if (n.alive &&
            Math.abs(n.x - b.x) <= blockW * 1.5 + BLOCK_GAP * 2 &&
            Math.abs(n.y - b.y) <= BLOCK_H + BLOCK_GAP * 2) destroyBlock(n);
      }
    }

    // A fireball keeps going; anything else bounces off the axis with the smaller penetration
    if (active?.type === 'fire') continue;
    const overlapX = r - Math.abs(dx);
    const overlapY = r - Math.abs(dy);
    if (dx === 0 && dy === 0) ball.vy = -ball.vy;
    else if (overlapX < overlapY) ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
    else ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
    break; // one block per frame avoids double-bounce weirdness
  }

  if (blocks.every(b => !b.alive)) {
    level++;
    buildBlocks();
    resetBall();
  } else if (ball.y - r > H) {
    lives--;
    if (lives <= 0) state = 'lost';
    else resetBall();
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  for (const b of blocks) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, blockW, BLOCK_H);
    if (b.powerup) {
      // Small marker so players can see which blocks hold a powerup
      ctx.fillStyle = POWERUPS[b.powerup].color;
      ctx.beginPath();
      ctx.arc(b.x + blockW / 2, b.y + BLOCK_H / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  ctx.fillStyle = active?.type === 'wide' ? POWERUPS.wide.color : '#ecf0f1';
  ctx.fillRect(paddle.x, paddle.y, paddleWidth(), PADDLE_H);

  ctx.fillStyle = active ? POWERUPS[active.type].color : '#ecf0f1';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ballRadius(), 0, Math.PI * 2);
  ctx.fill();

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
    ctx.fillText(`${POWERUPS[active.type].label} (${Math.ceil(active.timeLeft)}s)`, W - 10, H - 6);
  }

  ctx.fillStyle = '#ecf0f1';
  ctx.textAlign = 'center';
  if (state === 'playing' && !ball.launched) {
    ctx.fillText('Press Space or click to launch', W / 2, H / 2 + 60);
  } else if (state !== 'playing') {
    ctx.font = '32px sans-serif';
    ctx.fillText('Game over', W / 2, H / 2);
    ctx.font = '16px sans-serif';
    ctx.fillText('Press Space or click to play again', W / 2, H / 2 + 30);
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
