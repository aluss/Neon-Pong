// --- AUDIO SYNTHESIZER (Web Audio API) ---
class SoundController {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(frequency, type, duration, startGain = 0.15, endGain = 0.001) {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      gain.gain.setValueAtTime(startGain, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(endGain, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // AudioContext might be blocked until gesture
    }
  }

  hitPaddle() {
    this.playTone(480, 'sine', 0.1, 0.2);
  }

  hitWall() {
    this.playTone(320, 'triangle', 0.08, 0.15);
  }

  scorePlayer() {
    this.playTone(587.33, 'sine', 0.15, 0.25);
    setTimeout(() => this.playTone(880, 'sine', 0.3, 0.25), 120);
  }

  scoreCpu() {
    this.playTone(220, 'sawtooth', 0.2, 0.2);
    setTimeout(() => this.playTone(174.61, 'sawtooth', 0.35, 0.2), 150);
  }

  sloMoEnter() {
    this.playTone(220, 'sine', 0.18, 0.12, 0.001);
  }

  curveSound() {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(560, this.ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.16);
    } catch (e) {}
  }
}

// --- PARTICLE EFFECT SYSTEM ---
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  createBurst(x, y, color, count = 15) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3,
        color,
        alpha: 1,
        life: 0.02 + Math.random() * 0.03
      });
    }
  }

  update(dt = 1.0) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.life * dt;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  clear() {
    this.particles = [];
  }
}

// --- GAME LOGIC ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const sound = new SoundController();
const particles = new ParticleSystem();

// UI Elements
const playerScoreEl = document.getElementById('player-score');
const cpuScoreEl = document.getElementById('cpu-score');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const muteBtn = document.getElementById('mute-btn');
const slomoBtn = document.getElementById('slomo-btn');
const curveBtn = document.getElementById('curve-btn');
const diffButtons = document.querySelectorAll('.diff-btn');

// Game Parameters
const WINNING_SCORE = 5;
const PADDLE_WIDTH = 14;
const PADDLE_HEIGHT = 90;
const BALL_SIZE = 10;
const BASE_SPEED = 7;
const MAX_BALL_SPEED = 16;
const SLOMO_ZONE_X = canvas.width * 0.25; // 25% of court (last quarter of player's side)
const SLOMO_FACTOR = 0.48; // Slow-motion speed multiplier (50% faster than previous 0.32)

let state = 'READY'; // READY, PLAYING, PAUSED, OVER
let playerScore = 0;
let cpuScore = 0;
let difficulty = 'normal';
let sloMoEnabled = true;
let isInSloMo = false;
let curveEnabled = true;

// AI difficulty profiles
const AI_PROFILES = {
  normal: { maxSpeed: 4.8, reactionLag: 0.12, errorMargin: 20 },
  pro: { maxSpeed: 6.8, reactionLag: 0.05, errorMargin: 6 },
  impossible: { maxSpeed: 11.0, reactionLag: 0.0, errorMargin: 0 }
};

// Player paddle
const player = {
  x: 24,
  y: canvas.height / 2 - PADDLE_HEIGHT / 2,
  prevY: canvas.height / 2 - PADDLE_HEIGHT / 2,
  vy: 0,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
  targetY: canvas.height / 2 - PADDLE_HEIGHT / 2,
  color: '#00f3ff',
  glow: 'rgba(0, 243, 255, 0.8)'
};

// CPU paddle
const cpu = {
  x: canvas.width - 24 - PADDLE_WIDTH,
  y: canvas.height / 2 - PADDLE_HEIGHT / 2,
  prevY: canvas.height / 2 - PADDLE_HEIGHT / 2,
  vy: 0,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
  color: '#ff007b',
  glow: 'rgba(255, 0, 123, 0.8)'
};

// Ball object
const ball = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  vx: BASE_SPEED,
  vy: 0,
  radius: BALL_SIZE,
  speed: BASE_SPEED,
  spin: 0,
  trail: [],
  reset(servingPlayer = true) {
    this.x = canvas.width / 2;
    this.y = canvas.height / 2;
    this.speed = BASE_SPEED;
    this.spin = 0;
    this.trail = [];

    // Launch angle between -30° and +30°
    const angle = (Math.random() * 0.8 - 0.4);
    const direction = servingPlayer ? 1 : -1;
    this.vx = Math.cos(angle) * this.speed * direction;
    this.vy = Math.sin(angle) * this.speed;
  }
};

// --- MOUSE & TOUCH / SWIPE CONTROLS ---
let isTouchActive = false;

function setPaddleTarget(clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleY = canvas.height / rect.height;
  const rawY = (clientY - rect.top) * scaleY;
  // Center paddle on touch / mouse position
  const target = rawY - player.height / 2;
  // Clamp paddle to canvas bounds
  player.targetY = Math.max(8, Math.min(canvas.height - player.height - 8, target));
}

// Mouse events
canvas.addEventListener('mousemove', (e) => {
  setPaddleTarget(e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (state === 'PLAYING') {
    setPaddleTarget(e.clientY);
  }
});

// Touch / Finger swipe events (Mobile Web Browsers)
function handleTouch(e) {
  if (e.touches.length > 0) {
    const touch = e.touches[0];
    setPaddleTarget(touch.clientY);
  }
}

canvas.addEventListener('touchstart', (e) => {
  sound.init(); // Unlock Web Audio context on mobile user gesture
  isTouchActive = true;
  handleTouch(e);
  if (e.cancelable) e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  handleTouch(e);
  if (e.cancelable) e.preventDefault();
}, { passive: false });

// Allow smooth swiping even if finger glides slightly beyond canvas boundaries
window.addEventListener('touchmove', (e) => {
  if (isTouchActive && state === 'PLAYING') {
    handleTouch(e);
    if (e.cancelable) e.preventDefault();
  }
}, { passive: false });

window.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    isTouchActive = false;
  }
}, { passive: true });

window.addEventListener('touchcancel', () => {
  isTouchActive = false;
}, { passive: true });

// --- KEYBOARD & CONTROLS ---
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  } else if (e.code === 'KeyS') {
    e.preventDefault();
    toggleSloMo();
  } else if (e.code === 'KeyC') {
    e.preventDefault();
    toggleCurve();
  }
});

function togglePause() {
  if (state === 'PLAYING') {
    state = 'PAUSED';
    overlayTitle.textContent = 'GAME PAUSED';
    overlaySubtitle.textContent = 'Press Space or click Resume to continue';
    startBtn.textContent = 'RESUME';
    overlay.classList.remove('hidden');
  } else if (state === 'PAUSED') {
    state = 'PLAYING';
    overlay.classList.add('hidden');
  }
}

// Difficulty buttons
diffButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    diffButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff;
  });
});

// Start button
startBtn.addEventListener('click', () => {
  sound.init();
  if (state === 'PAUSED') {
    state = 'PLAYING';
    overlay.classList.add('hidden');
  } else {
    resetMatch();
    state = 'PLAYING';
    overlay.classList.add('hidden');
  }
});

// Reset button
resetBtn.addEventListener('click', () => {
  resetMatch();
  showStartScreen();
});

// Sound toggle
muteBtn.addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  muteBtn.textContent = sound.enabled ? 'Sound: ON' : 'Sound: OFF';
});

// Slo-Mo toggle
slomoBtn.addEventListener('click', () => {
  sound.init();
  toggleSloMo();
});

function toggleSloMo() {
  sloMoEnabled = !sloMoEnabled;
  if (sloMoEnabled) {
    slomoBtn.classList.remove('off');
    slomoBtn.classList.add('active');
    slomoBtn.textContent = '⏱️ Slo-Mo: ON';
  } else {
    slomoBtn.classList.add('off');
    slomoBtn.classList.remove('active');
    slomoBtn.textContent = '⏱️ Slo-Mo: OFF';
    isInSloMo = false;
  }
}

// Curve Physics toggle
curveBtn.addEventListener('click', () => {
  sound.init();
  toggleCurve();
});

function toggleCurve() {
  curveEnabled = !curveEnabled;
  if (curveEnabled) {
    curveBtn.classList.remove('off');
    curveBtn.classList.add('active');
    curveBtn.textContent = '🌀 Curve: ON';
  } else {
    curveBtn.classList.add('off');
    curveBtn.classList.remove('active');
    curveBtn.textContent = '🌀 Curve: OFF';
    ball.spin = 0;
  }
}

// Fullscreen toggle
const fullscreenBtn = document.getElementById('fullscreen-btn');
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  });

  const updateFsBtn = () => {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.textContent = isFs ? '⛶ Exit' : '⛶ Fullscreen';
  };

  document.addEventListener('fullscreenchange', updateFsBtn);
  document.addEventListener('webkitfullscreenchange', updateFsBtn);
}

function showStartScreen() {
  state = 'READY';
  overlayTitle.textContent = 'READY TO PLAY?';
  overlaySubtitle.textContent = 'Move your mouse up and down to steer your paddle.';
  startBtn.textContent = 'START GAME';
  overlay.classList.remove('hidden');
}

function resetMatch() {
  playerScore = 0;
  cpuScore = 0;
  playerScoreEl.textContent = '0';
  cpuScoreEl.textContent = '0';
  particles.clear();
  ball.reset(true);
}

// --- UPDATE LOOP (Frame-Rate Independent) ---
function update(dt = 1.0) {
  if (state !== 'PLAYING') return;

  // 1. Move Player paddle (smooth snap to mouse/touch, dt normalized)
  player.prevY = player.y;
  player.y += (player.targetY - player.y) * Math.min(1.0, 0.35 * dt);
  player.vy = (player.y - player.prevY) / dt;

  // 2. Move CPU paddle (AI, dt normalized)
  cpu.prevY = cpu.y;
  const profile = AI_PROFILES[difficulty];
  const cpuCenter = cpu.y + cpu.height / 2;
  
  // Predict target with slight error margin
  let targetCpuY = ball.y;
  if (ball.vx < 0 && difficulty !== 'impossible') {
    // Return toward center when ball moves away
    targetCpuY = canvas.height / 2;
  }

  const diff = targetCpuY - cpuCenter;
  if (Math.abs(diff) > profile.errorMargin) {
    const moveStep = Math.sign(diff) * Math.min(Math.abs(diff), profile.maxSpeed * dt);
    cpu.y += moveStep;
  }
  // Clamp CPU paddle
  cpu.y = Math.max(8, Math.min(canvas.height - cpu.height - 8, cpu.y));
  cpu.vy = (cpu.y - cpu.prevY) / dt;

  // 3. Move Ball (with Slo-Mo in last quarter of player's court)
  const currentlyInSloMo = sloMoEnabled && (ball.x <= SLOMO_ZONE_X) && (ball.vx < 0);
  
  if (currentlyInSloMo && !isInSloMo) {
    sound.sloMoEnter();
    particles.createBurst(ball.x, ball.y, '#00f3ff', 8);
  }
  isInSloMo = currentlyInSloMo;

  const timeScale = currentlyInSloMo ? SLOMO_FACTOR : 1.0;

  // Apply Curve Physics: ball.spin bends the vertical velocity over time (dt normalized)
  if (curveEnabled && Math.abs(ball.spin) > 0.005) {
    ball.vy += ball.spin * 1.5 * timeScale * dt;
    ball.spin *= Math.pow(0.985, dt); // Air resistance gradually neutralizes spin
    // Sparkle trail on strong spin
    if (Math.abs(ball.spin) > 0.1 && Math.random() < 0.35 * dt) {
      particles.createBurst(ball.x, ball.y, '#d880ff', 2);
    }
  }

  ball.x += ball.vx * timeScale * dt;
  ball.y += ball.vy * timeScale * dt;

  // Ball trail effect
  const isCurved = curveEnabled && Math.abs(ball.spin) > 0.08;
  ball.trail.push({ x: ball.x, y: ball.y, isSloMo: currentlyInSloMo, isCurved });
  const maxTrail = currentlyInSloMo ? 14 : 7;
  if (ball.trail.length > maxTrail) {
    ball.trail.shift();
  }

  // Top/Bottom Wall Collisions
  if (ball.y - ball.radius <= 0) {
    ball.y = ball.radius;
    ball.vy *= -1;
    ball.spin *= -0.5; // Rebound dampens and flips spin
    sound.hitWall();
    particles.createBurst(ball.x, ball.y, '#ffffff', 8);
  } else if (ball.y + ball.radius >= canvas.height) {
    ball.y = canvas.height - ball.radius;
    ball.vy *= -1;
    ball.spin *= -0.5; // Rebound dampens and flips spin
    sound.hitWall();
    particles.createBurst(ball.x, ball.y, '#ffffff', 8);
  }

  // 4. Paddle Collisions
  // Player collision (left)
  if (
    ball.x - ball.radius <= player.x + player.width &&
    ball.x + ball.radius >= player.x &&
    ball.y >= player.y &&
    ball.y <= player.y + player.height &&
    ball.vx < 0
  ) {
    handlePaddleHit(player);
  }

  // CPU collision (right)
  if (
    ball.x + ball.radius >= cpu.x &&
    ball.x - ball.radius <= cpu.x + cpu.width &&
    ball.y >= cpu.y &&
    ball.y <= cpu.y + cpu.height &&
    ball.vx > 0
  ) {
    handlePaddleHit(cpu);
  }

  // 5. Check Score (Left / Right boundaries)
  if (ball.x < 0) {
    // CPU scores
    cpuScore++;
    cpuScoreEl.textContent = cpuScore;
    sound.scoreCpu();
    particles.createBurst(ball.x, ball.y, cpu.color, 25);
    checkGameOver() || ball.reset(true);
  } else if (ball.x > canvas.width) {
    // Player scores
    playerScore++;
    playerScoreEl.textContent = playerScore;
    sound.scorePlayer();
    particles.createBurst(ball.x, ball.y, player.color, 25);
    checkGameOver() || ball.reset(false);
  }

  // Update particle system
  particles.update(dt);
}

function handlePaddleHit(paddle) {
  sound.hitPaddle();
  
  // Calculate hit angle based on offset from center of paddle (-1 to 1)
  const paddleCenter = paddle.y + paddle.height / 2;
  const offset = (ball.y - paddleCenter) / (paddle.height / 2);
  const maxBounceAngle = (5 * Math.PI) / 12; // 75 degrees max
  const bounceAngle = offset * maxBounceAngle;

  // Increase speed slightly with each volley
  ball.speed = Math.min(ball.speed + 0.45, MAX_BALL_SPEED);

  const direction = paddle === player ? 1 : -1;
  ball.vx = Math.cos(bounceAngle) * ball.speed * direction;
  ball.vy = Math.sin(bounceAngle) * ball.speed;

  // Curve Physics: If enabled, paddle vertical slice velocity curves the ball
  if (curveEnabled) {
    const curveForce = Math.max(-0.45, Math.min(0.45, paddle.vy * 0.035));
    ball.spin = curveForce;
    if (Math.abs(ball.spin) > 0.07) {
      sound.curveSound();
      particles.createBurst(ball.x, ball.y, '#b026ff', 12);
    }
  } else {
    ball.spin = 0;
  }

  // Push ball outside paddle to avoid sticking
  if (paddle === player) {
    ball.x = player.x + player.width + ball.radius;
  } else {
    ball.x = cpu.x - ball.radius;
  }

  particles.createBurst(ball.x, ball.y, paddle.color, 14);
}

function checkGameOver() {
  if (playerScore >= WINNING_SCORE || cpuScore >= WINNING_SCORE) {
    state = 'OVER';
    const playerWon = playerScore >= WINNING_SCORE;
    overlayTitle.textContent = playerWon ? 'VICTORY!' : 'CPU WINS!';
    overlayTitle.style.color = playerWon ? '#00f3ff' : '#ff007b';
    overlaySubtitle.textContent = playerWon 
      ? `Phenomenal reflex! You won ${playerScore} - ${cpuScore}.` 
      : `Good effort! CPU won ${cpuScore} - ${playerScore}.`;
    startBtn.textContent = 'PLAY AGAIN';
    overlay.classList.remove('hidden');
    return true;
  }
  return false;
}

// --- RENDER LOOP ---
function draw() {
  // Clear court with slight trail effect
  ctx.fillStyle = '#06090e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw Slo-Mo Zone (left 25% of the board)
  if (sloMoEnabled) {
    ctx.save();
    const zoneWidth = SLOMO_ZONE_X;
    
    // Gradient wash for the slo-mo quadrant
    const zoneGrad = ctx.createLinearGradient(0, 0, zoneWidth, 0);
    zoneGrad.addColorStop(0, isInSloMo ? 'rgba(0, 243, 255, 0.16)' : 'rgba(0, 243, 255, 0.04)');
    zoneGrad.addColorStop(1, 'rgba(0, 243, 255, 0.0)');
    ctx.fillStyle = zoneGrad;
    ctx.fillRect(0, 0, zoneWidth, canvas.height);

    // Subtle dashed barrier
    ctx.strokeStyle = isInSloMo ? 'rgba(0, 243, 255, 0.7)' : 'rgba(0, 243, 255, 0.2)';
    ctx.lineWidth = isInSloMo ? 2 : 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(zoneWidth, 0);
    ctx.lineTo(zoneWidth, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Indicator tag
    ctx.fillStyle = isInSloMo ? '#00f3ff' : 'rgba(0, 243, 255, 0.45)';
    ctx.font = '700 12px Rajdhani';
    ctx.textAlign = 'right';
    ctx.fillText(isInSloMo ? '⏱️ SLO-MO ENGAGED (0.48x)' : '⏱️ SLO-MO FIELD (25%)', zoneWidth - 10, 22);
    ctx.restore();
  }

  // Draw Center Court Line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Center Circle
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 70, 0, Math.PI * 2);
  ctx.stroke();

  // Draw Ball Trail
  for (let i = 0; i < ball.trail.length; i++) {
    const pt = ball.trail[i];
    const alpha = (i + 1) / (ball.trail.length * 3);
    const size = ball.radius * (0.4 + 0.6 * ((i + 1) / ball.trail.length));
    let trailColor = '#ffe600';
    if (pt.isSloMo) {
      trailColor = '#00f3ff';
    } else if (pt.isCurved) {
      trailColor = '#d880ff';
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = trailColor;
    ctx.shadowColor = trailColor;
    ctx.shadowBlur = (pt.isSloMo || pt.isCurved) ? 10 : 4;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw Ball
  ctx.save();
  let ballColor = '#ffe600';
  let glowColor = 'rgba(255, 230, 0, 0.9)';
  const isCurving = curveEnabled && Math.abs(ball.spin) > 0.08;

  if (isInSloMo) {
    ballColor = '#00f3ff';
    glowColor = 'rgba(0, 243, 255, 0.95)';
  } else if (isCurving) {
    ballColor = '#f080ff';
    glowColor = 'rgba(176, 38, 255, 0.95)';
  }

  ctx.fillStyle = ballColor;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = (isInSloMo || isCurving) ? 22 : 16;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Time-dilation ripple ring when in slo-mo
  if (isInSloMo) {
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius + 6, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isCurving) {
    // Spinning energy vortex arc around ball
    ctx.strokeStyle = '#d880ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const spinAngle = (Date.now() * 0.015) * Math.sign(ball.spin);
    ctx.arc(ball.x, ball.y, ball.radius + 5, spinAngle, spinAngle + Math.PI * 1.2);
    ctx.stroke();
  }
  ctx.restore();

  // Draw Player Paddle (Glow + Rounded Rect)
  drawPaddle(player.x, player.y, player.width, player.height, player.color, player.glow);

  // Draw CPU Paddle
  drawPaddle(cpu.x, cpu.y, cpu.width, cpu.height, cpu.color, cpu.glow);

  // Draw Particles
  particles.draw(ctx);
}

function drawPaddle(x, y, w, h, color, glowColor) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 18;
  const radius = w / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

// Main Game Loop (Frame-Rate Independent with Delta Time)
let lastFrameTimestamp = 0;

function loop(timestamp = 0) {
  if (!lastFrameTimestamp) lastFrameTimestamp = timestamp;
  const elapsedSec = (timestamp - lastFrameTimestamp) / 1000;
  lastFrameTimestamp = timestamp;

  // Frame-rate normalization:
  // Base physics is tuned for 60 FPS (1 / 60 ≈ 0.01667s per frame).
  // On 120Hz/144Hz screens, dt ≈ 0.5. On 60Hz screens, dt ≈ 1.0.
  // Clamp between 0.1 and 2.5 to avoid large physics glitches on tab resume.
  const dt = Math.max(0.1, Math.min(elapsedSec / 0.016667, 2.5));

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// Kick off loop & initial display
ball.reset(true);
requestAnimationFrame(loop);
