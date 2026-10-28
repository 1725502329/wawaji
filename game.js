(() => {
  'use strict';

  /* ============================================================
     CLAWVERSE — a hand-built pseudo-3D claw machine
     All rendering is Canvas 2D with a real 3D projection so the
     camera can orbit cleanly between four points of view.
     ============================================================ */

  const TAU = Math.PI * 2;
  const DISPLAY_FONT = '"Bahnschrift SemiBold", "Arial Narrow", "Microsoft YaHei", sans-serif';
  const UI_FONT = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const rand = (a, b) => a + Math.random() * (b - a);
  const damp = (current, target, speed, dt) => lerp(current, target, 1 - Math.exp(-speed * dt));
  const shortestAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function normalize3(x, y, z) {
    const l = Math.hypot(x, y, z) || 1;
    return { x: x / l, y: y / l, z: z / l };
  }

  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  /* ---------------- DOM ---------------- */

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const safeProbe = document.getElementById('safeProbe');
  const coinValue = document.getElementById('coinValue');
  const scoreValue = document.getElementById('scoreValue');
  const viewName = document.getElementById('viewName');
  const aimReadout = document.getElementById('aimReadout');
  const aimText = document.getElementById('aimText');
  const dropBtn = document.getElementById('dropBtn');
  const dropMain = document.getElementById('dropMain');
  const dropSub = document.getElementById('dropSub');
  const toastEl = document.getElementById('toast');
  const joystick = document.getElementById('joystick');
  const joyKnob = document.getElementById('joyKnob');
  const soundBtn = document.getElementById('soundBtn');
  const helpBtn = document.getElementById('helpBtn');
  const startOverlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpClose = document.getElementById('helpClose');
  const helpResume = document.getElementById('helpResume');
  const endOverlay = document.getElementById('endOverlay');
  const endBadge = document.getElementById('endBadge');
  const endTitle = document.getElementById('endTitle');
  const endText = document.getElementById('endText');
  const endScore = document.getElementById('endScore');
  const endCollected = document.getElementById('endCollected');
  const endBest = document.getElementById('endBest');
  const againBtn = document.getElementById('againBtn');
  const viewButtons = Array.from(document.querySelectorAll('.view-btn'));
  const collectionItems = new Map();

  document.querySelectorAll('.collect-item').forEach((item) => {
    collectionItems.set(item.dataset.type, {
      item,
      count: item.querySelector('.collect-count'),
    });
  });

  /* ---------------- Viewport / Camera ---------------- */

  let W = 1;
  let H = 1;
  let DPR = 1;
  let SAFE_TOP = 0;

  const CAM = {
    angle: 0,
    targetAngle: 0,
    view: 0,
    elev: 0.335,
    dist: 29,
    targetY: 8.55,
    focal: 1200,
    cx: 0,
    cy: 0,
    eye: { x: 0, y: 16, z: 27 },
    fwd: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };

  const VIEW_NAMES = ['正面', '右侧', '背面', '左侧'];

  function computeViewport() {
    const narrow = W <= 820;
    CAM.cx = W * 0.5;
    CAM.cy = H * (narrow ? 0.56 : 0.5) + (narrow ? SAFE_TOP * 0.75 : 0);
    const narrowZoom = clamp(H / 900, 0.76, 0.95);
    const vertical = H * (narrow ? narrowZoom : H < 760 ? 1.05 : 1.18);
    const horizontal = W * (narrow ? 1.95 : 2.15);
    let focal = Math.min(vertical, horizontal);
    if (!narrow) {
      // Keep the cabinet clear of the two side panels on narrow desktops.
      const halfAvail = Math.max(150, W * 0.5 - 212);
      const panelCap = (halfAvail * 2 * 23) / 10.8;
      focal = Math.min(focal, panelCap);
    }
    CAM.focal = focal;
  }

  function updateCamera(dt, instant = false) {
    if (instant) {
      CAM.angle = CAM.targetAngle;
    } else {
      const diff = shortestAngle(CAM.targetAngle - CAM.angle);
      if (Math.abs(diff) < 0.0004) {
        CAM.angle = CAM.targetAngle;
      } else {
        CAM.angle += diff * (1 - Math.exp(-7.5 * dt));
      }
    }

    const ce = Math.cos(CAM.elev);
    const se = Math.sin(CAM.elev);
    CAM.eye.x = Math.sin(CAM.angle) * CAM.dist * ce;
    CAM.eye.y = CAM.targetY + se * CAM.dist;
    CAM.eye.z = Math.cos(CAM.angle) * CAM.dist * ce;

    const target = { x: 0, y: CAM.targetY, z: 0 };
    CAM.fwd = normalize3(target.x - CAM.eye.x, target.y - CAM.eye.y, target.z - CAM.eye.z);
    const right = normalize3(
      cross3(CAM.fwd, { x: 0, y: 1, z: 0 }).x,
      cross3(CAM.fwd, { x: 0, y: 1, z: 0 }).y,
      cross3(CAM.fwd, { x: 0, y: 1, z: 0 }).z
    );
    CAM.right = right;
    CAM.up = cross3(right, CAM.fwd);
  }

  function projectPoint(x, y, z) {
    const dx = x - CAM.eye.x;
    const dy = y - CAM.eye.y;
    const dz = z - CAM.eye.z;
    const depth = Math.max(0.2, dx * CAM.fwd.x + dy * CAM.fwd.y + dz * CAM.fwd.z);
    const sx = dx * CAM.right.x + dy * CAM.right.y + dz * CAM.right.z;
    const sy = dx * CAM.up.x + dy * CAM.up.y + dz * CAM.up.z;
    const scale = CAM.focal / depth;
    return {
      x: CAM.cx + sx * scale,
      y: CAM.cy - sy * scale,
      d: depth,
      s: scale,
    };
  }

  function projectCircle(x, z, radius, y, segments = 28) {
    const points = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * TAU;
      points.push(projectPoint(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius));
    }
    return points;
  }

  /* ---------------- Tiny canvas helpers ---------------- */

  function pathPoints(points) {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  }

  function poly(points, fill, stroke, lineWidth = 1) {
    if (points.length < 3) return;
    pathPoints(points);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function line(points, color, width = 1) {
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawLine3D(a, b, options = {}) {
    const pa = projectPoint(a.x, a.y, a.z);
    const pb = projectPoint(b.x, b.y, b.z);
    const width = Math.max(0.55, (options.width || 0.02) * ((pa.s + pb.s) * 0.5));
    ctx.save();
    if (options.alpha != null) ctx.globalAlpha *= options.alpha;
    if (options.glow) {
      ctx.shadowColor = options.color || '#ffffff';
      ctx.shadowBlur = Math.max(2, options.glow * ((pa.s + pb.s) * 0.5));
    }
    if (options.dash) ctx.setLineDash(options.dash);
    line([pa, pb], options.color || '#ffffff', width);
    ctx.restore();
  }

  function drawNeonLine(a, b, color, width = 0.018, alpha = 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawLine3D(a, b, { color, width: width * 3.1, alpha: alpha * 0.1, glow: width * 5 });
    drawLine3D(a, b, { color, width, alpha, glow: width * 5 });
    ctx.restore();
  }

  function drawQuad3D(points, fill, stroke, lineWidth = 1, glowColor = null) {
    const ps = points.map((p) => projectPoint(p[0], p[1], p[2]));
    ctx.save();
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
    }
    poly(ps, fill, stroke, lineWidth);
    ctx.restore();
    return ps;
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
  }

  function convexHull(points) {
    if (points.length <= 3) return points.slice();
    const sorted = points
      .slice()
      .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  /* ---------------- Plush definitions ---------------- */

  const PLUSH = {
    bear: {
      name: '棕熊',
      points: 12,
      grip: 0.95,
      accent: '#ffc27d',
      colors: {
        body: '#bc8157',
        light: '#dba275',
        dark: '#8f5939',
        cream: '#f7dfba',
        blush: '#ee9e9f',
      },
    },
    bunny: {
      name: '兔兔',
      points: 14,
      grip: 0.88,
      accent: '#ffa9c5',
      colors: {
        body: '#f7e9e7',
        light: '#fff8f4',
        dark: '#d6c1c7',
        cream: '#fff6f1',
        blush: '#f4a7be',
      },
    },
    penguin: {
      name: '企鹅',
      points: 16,
      grip: 0.82,
      accent: '#74d9ff',
      colors: {
        body: '#263a62',
        light: '#3e5989',
        dark: '#182644',
        cream: '#f4f1e8',
        blush: '#f29ea7',
        beak: '#ffa843',
      },
    },
    duck: {
      name: '鸭鸭',
      points: 18,
      grip: 0.78,
      accent: '#ffd45e',
      colors: {
        body: '#ffd05a',
        light: '#ffe58c',
        dark: '#e7ac35',
        cream: '#fff3c0',
        blush: '#f6a09f',
        beak: '#ff9842',
      },
    },
    cat: {
      name: '橘猫',
      points: 20,
      grip: 0.84,
      accent: '#ffb068',
      colors: {
        body: '#f0a05b',
        light: '#ffc07d',
        dark: '#cf7936',
        cream: '#fff0d8',
        blush: '#f39a98',
      },
    },
    star: {
      name: '星星',
      points: 40,
      grip: 0.72,
      accent: '#ffe174',
      colors: {
        body: '#ffd45e',
        light: '#fff1a3',
        dark: '#e8a72f',
        cream: '#fff8d7',
        blush: '#f3a391',
      },
    },
    doodle: {
      name: '涂鸦鸡',
      points: 60,
      grip: 0.7,
      accent: '#fff8e8',
      colors: {
        body: '#f7f2e5',
        light: '#fffdf7',
        dark: '#d8cfbd',
        ink: '#141118',
      },
    },
  };

  const PLUSH_ORDER = ['bear', 'bunny', 'penguin', 'duck', 'cat', 'star', 'doodle'];

  /* ---------------- Plush drawing ---------------- */

  function ePath(c, x, y, rx, ry, rot) {
    c.beginPath();
    c.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), rot || 0, 0, TAU);
  }

  function eFill(c, x, y, rx, ry, fill, rot) {
    ePath(c, x, y, rx, ry, rot);
    c.fillStyle = fill;
    c.fill();
  }

  function eShape(c, x, y, rx, ry, fill, stroke, lw, rot) {
    ePath(c, x, y, rx, ry, rot);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw || 0.035;
      c.stroke();
    }
  }

  function cFill(c, x, y, r, fill) {
    c.beginPath();
    c.arc(x, y, Math.max(0.001, r), 0, TAU);
    c.fillStyle = fill;
    c.fill();
  }

  function cShape(c, x, y, r, fill, stroke, lw) {
    c.beginPath();
    c.arc(x, y, Math.max(0.001, r), 0, TAU);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw || 0.035;
      c.stroke();
    }
  }

  function gradientY(c, y0, y1, stops) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([p, color]) => g.addColorStop(p, color));
    return g;
  }

  function drawSparkle(c, x, y, r, color, rotation = 0) {
    c.save();
    c.translate(x, y);
    c.rotate(rotation);
    c.beginPath();
    c.moveTo(0, -r);
    c.quadraticCurveTo(r * 0.13, -r * 0.13, r, 0);
    c.quadraticCurveTo(r * 0.13, r * 0.13, 0, r);
    c.quadraticCurveTo(-r * 0.13, r * 0.13, -r, 0);
    c.quadraticCurveTo(-r * 0.13, -r * 0.13, 0, -r);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.restore();
  }

  function starPath(c, cx, cy, outer, inner, points = 5) {
    c.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / points;
      const radius = i % 2 === 0 ? outer : inner;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }

  function drawPlushLocal(c, type, opt = {}) {
    const spec = PLUSH[type];
    const col = spec.colors;
    const outline = 'rgba(24, 16, 32, 0.4)';
    const lw = 0.034;

    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';

    if (opt.tilt) c.rotate(opt.tilt);
    if (opt.squash) c.scale(1, opt.squash);

    // A tiny contact shading at the base keeps every plush grounded.
    if (!opt.air) eFill(c, 0, -0.035, 0.42, 0.06, 'rgba(0, 0, 0, 0.14)');

    if (type === 'bear') {
      eShape(c, -0.31, -1.65, 0.18, 0.18, col.dark, outline, lw);
      eShape(c, 0.31, -1.65, 0.18, 0.18, col.dark, outline, lw);
      eFill(c, -0.31, -1.65, 0.09, 0.09, col.blush);
      eFill(c, 0.31, -1.65, 0.09, 0.09, col.blush);

      eShape(c, -0.23, -0.1, 0.21, 0.13, col.dark, outline, lw);
      eShape(c, 0.23, -0.1, 0.21, 0.13, col.dark, outline, lw);

      eShape(c, -0.46, -0.79, 0.16, 0.33, col.dark, outline, lw, -0.22);
      eShape(c, 0.46, -0.79, 0.16, 0.33, col.dark, outline, lw, 0.22);

      const body = gradientY(c, -1.15, -0.12, [
        [0, col.light],
        [0.6, col.body],
        [1, col.dark],
      ]);
      eShape(c, 0, -0.67, 0.52, 0.56, body, outline, lw);
      eFill(c, 0, -0.55, 0.31, 0.38, col.cream);

      const head = gradientY(c, -1.8, -0.95, [
        [0, col.light],
        [0.62, col.body],
        [1, col.dark],
      ]);
      cShape(c, 0, -1.36, 0.44, head, outline, lw);
      eFill(c, 0, -1.25, 0.21, 0.145, col.cream);

      cFill(c, -0.155, -1.4, 0.045, '#2c1d24');
      cFill(c, 0.155, -1.4, 0.045, '#2c1d24');
      cFill(c, -0.145, -1.415, 0.014, 'rgba(255,255,255,0.8)');
      cFill(c, 0.165, -1.415, 0.014, 'rgba(255,255,255,0.8)');
      eFill(c, 0, -1.3, 0.06, 0.045, '#332229');
      c.strokeStyle = '#4b3030';
      c.lineWidth = 0.016;
      c.beginPath();
      c.moveTo(0, -1.255);
      c.quadraticCurveTo(-0.028, -1.22, -0.06, -1.235);
      c.moveTo(0, -1.255);
      c.quadraticCurveTo(0.028, -1.22, 0.06, -1.235);
      c.stroke();
      eFill(c, -0.33, -1.275, 0.06, 0.032, 'rgba(238, 142, 143, 0.48)');
      eFill(c, 0.33, -1.275, 0.06, 0.032, 'rgba(238, 142, 143, 0.48)');
      eFill(c, -0.14, -1.55, 0.13, 0.06, 'rgba(255, 255, 255, 0.2)');
    }

    if (type === 'bunny') {
      eShape(c, -0.19, -1.93, 0.12, 0.38, col.body, outline, lw, -0.13);
      eShape(c, 0.19, -1.93, 0.12, 0.38, col.body, outline, lw, 0.13);
      eFill(c, -0.19, -1.96, 0.055, 0.28, col.blush, -0.13);
      eFill(c, 0.19, -1.96, 0.055, 0.28, col.blush, 0.13);

      eShape(c, -0.22, -0.08, 0.2, 0.13, col.body, outline, lw);
      eShape(c, 0.22, -0.08, 0.2, 0.13, col.body, outline, lw);
      eShape(c, -0.43, -0.76, 0.14, 0.32, col.body, outline, lw, -0.2);
      eShape(c, 0.43, -0.76, 0.14, 0.32, col.body, outline, lw, 0.2);

      const body = gradientY(c, -1.15, -0.1, [
        [0, col.light],
        [0.62, col.body],
        [1, col.dark],
      ]);
      eShape(c, 0, -0.65, 0.49, 0.55, body, outline, lw);
      eFill(c, 0, -0.52, 0.31, 0.38, col.cream);

      const head = gradientY(c, -1.78, -0.94, [
        [0, col.light],
        [0.6, col.body],
        [1, col.dark],
      ]);
      cShape(c, 0, -1.32, 0.43, head, outline, lw);
      eFill(c, 0, -1.21, 0.19, 0.13, col.cream);
      cFill(c, -0.15, -1.35, 0.044, '#3a2830');
      cFill(c, 0.15, -1.35, 0.044, '#3a2830');
      cFill(c, -0.138, -1.365, 0.013, 'rgba(255,255,255,0.85)');
      cFill(c, 0.162, -1.365, 0.013, 'rgba(255,255,255,0.85)');
      eFill(c, 0, -1.25, 0.045, 0.033, '#e18fa7');
      c.strokeStyle = '#805666';
      c.lineWidth = 0.015;
      c.beginPath();
      c.moveTo(0, -1.215);
      c.quadraticCurveTo(-0.03, -1.185, -0.06, -1.198);
      c.moveTo(0, -1.215);
      c.quadraticCurveTo(0.03, -1.185, 0.06, -1.198);
      c.stroke();
      eFill(c, -0.31, -1.23, 0.055, 0.03, 'rgba(242, 150, 176, 0.42)');
      eFill(c, 0.31, -1.23, 0.055, 0.03, 'rgba(242, 150, 176, 0.42)');
      eFill(c, -0.14, -1.51, 0.13, 0.055, 'rgba(255, 255, 255, 0.23)');

      // little bow
      c.save();
      c.translate(0.31, -1.63);
      c.rotate(0.25);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-0.11, -0.09);
      c.lineTo(-0.11, 0.09);
      c.closePath();
      c.fillStyle = '#f28eb5';
      c.fill();
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(0.11, -0.09);
      c.lineTo(0.11, 0.09);
      c.closePath();
      c.fill();
      cFill(c, 0, 0, 0.035, '#ffd1e2');
      c.restore();
    }

    if (type === 'penguin') {
      eFill(c, -0.2, -0.055, 0.19, 0.09, col.beak);
      eFill(c, 0.2, -0.055, 0.19, 0.09, col.beak);
      eShape(c, -0.45, -0.72, 0.13, 0.34, col.dark, outline, lw, -0.2);
      eShape(c, 0.45, -0.72, 0.13, 0.34, col.dark, outline, lw, 0.2);

      const body = gradientY(c, -1.1, -0.08, [
        [0, col.light],
        [0.48, col.body],
        [1, col.dark],
      ]);
      eShape(c, 0, -0.64, 0.5, 0.57, body, outline, lw);
      eFill(c, 0, -0.6, 0.34, 0.43, col.cream);

      const head = gradientY(c, -1.82, -0.98, [
        [0, col.light],
        [0.55, col.body],
        [1, col.body],
      ]);
      cShape(c, 0, -1.38, 0.4, head, outline, lw);
      eFill(c, -0.145, -1.4, 0.185, 0.17, col.cream);
      eFill(c, 0.145, -1.4, 0.185, 0.17, col.cream);
      eFill(c, 0, -1.4, 0.09, 0.16, col.cream);

      cFill(c, -0.15, -1.43, 0.04, '#141722');
      cFill(c, 0.15, -1.43, 0.04, '#141722');
      cFill(c, -0.138, -1.445, 0.012, 'rgba(255,255,255,0.8)');
      cFill(c, 0.162, -1.445, 0.012, 'rgba(255,255,255,0.8)');

      c.beginPath();
      c.moveTo(-0.075, -1.29);
      c.lineTo(0.075, -1.29);
      c.lineTo(0.005, -1.19);
      c.closePath();
      c.fillStyle = col.beak;
      c.fill();

      // scarf
      c.save();
      c.strokeStyle = 'rgba(24,16,32,0.35)';
      c.lineWidth = 0.035;
      c.beginPath();
      c.moveTo(-0.34, -1.04);
      c.quadraticCurveTo(0, -0.98, 0.34, -1.04);
      c.stroke();
      c.strokeStyle = '#64dcea';
      c.lineWidth = 0.075;
      c.beginPath();
      c.moveTo(-0.34, -1.04);
      c.quadraticCurveTo(0, -0.98, 0.34, -1.04);
      c.stroke();
      c.strokeStyle = '#b7fbff';
      c.lineWidth = 0.02;
      c.beginPath();
      c.moveTo(-0.33, -1.065);
      c.quadraticCurveTo(0, -1.005, 0.33, -1.065);
      c.stroke();
      c.fillStyle = '#58cddd';
      c.beginPath();
      c.moveTo(0.25, -1.0);
      c.lineTo(0.34, -0.7);
      c.lineTo(0.19, -0.75);
      c.closePath();
      c.fill();
      c.restore();

      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = 0.018;
      c.beginPath();
      c.moveTo(-0.26, -1.52);
      c.quadraticCurveTo(-0.15, -1.62, 0.02, -1.6);
      c.stroke();
      eFill(c, -0.31, -1.24, 0.05, 0.028, 'rgba(243, 142, 150, 0.4)');
      eFill(c, 0.31, -1.24, 0.05, 0.028, 'rgba(243, 142, 150, 0.4)');

      // tuft
      c.strokeStyle = col.dark;
      c.lineWidth = 0.045;
      c.beginPath();
      c.moveTo(0.02, -1.77);
      c.quadraticCurveTo(0.08, -1.88, 0.15, -1.8);
      c.stroke();
    }

    if (type === 'duck') {
      eFill(c, -0.2, -0.055, 0.18, 0.085, col.beak);
      eFill(c, 0.2, -0.055, 0.18, 0.085, col.beak);

      const body = gradientY(c, -1.08, -0.08, [
        [0, col.light],
        [0.58, col.body],
        [1, col.dark],
      ]);
      eShape(c, 0, -0.63, 0.5, 0.54, body, outline, lw);
      eFill(c, 0, -0.58, 0.29, 0.38, 'rgba(255, 243, 192, 0.72)');
      eShape(c, -0.43, -0.65, 0.14, 0.3, col.light, outline, lw, -0.48);
      eShape(c, 0.43, -0.65, 0.14, 0.3, col.light, outline, lw, 0.48);

      const head = gradientY(c, -1.8, -0.98, [
        [0, col.light],
        [0.65, col.body],
        [1, col.dark],
      ]);
      cShape(c, 0, -1.35, 0.41, head, outline, lw);

      cFill(c, -0.15, -1.42, 0.045, '#38262a');
      cFill(c, 0.15, -1.42, 0.045, '#38262a');
      cFill(c, -0.137, -1.435, 0.014, 'rgba(255,255,255,0.85)');
      cFill(c, 0.163, -1.435, 0.014, 'rgba(255,255,255,0.85)');

      eShape(c, 0, -1.22, 0.22, 0.1, col.beak, 'rgba(135, 68, 18, 0.35)', 0.025);
      c.strokeStyle = 'rgba(147, 74, 20, 0.5)';
      c.lineWidth = 0.015;
      c.beginPath();
      c.moveTo(-0.15, -1.21);
      c.quadraticCurveTo(0, -1.17, 0.15, -1.21);
      c.stroke();

      eFill(c, -0.31, -1.25, 0.055, 0.03, 'rgba(245, 139, 126, 0.48)');
      eFill(c, 0.31, -1.25, 0.055, 0.03, 'rgba(245, 139, 126, 0.48)');
      eFill(c, -0.14, -1.55, 0.13, 0.052, 'rgba(255, 255, 255, 0.22)');

      c.strokeStyle = col.dark;
      c.lineWidth = 0.045;
      c.beginPath();
      c.moveTo(-0.07, -1.75);
      c.quadraticCurveTo(-0.13, -1.89, 0, -1.87);
      c.quadraticCurveTo(0.12, -1.98, 0.1, -1.79);
      c.stroke();

      // tiny sailor collar
      c.fillStyle = '#61cfe5';
      c.beginPath();
      c.moveTo(-0.27, -1.0);
      c.lineTo(0, -0.9);
      c.lineTo(0.27, -1.0);
      c.lineTo(0.18, -0.87);
      c.lineTo(0, -0.82);
      c.lineTo(-0.18, -0.87);
      c.closePath();
      c.fill();
    }

    if (type === 'cat') {
      c.save();
      c.strokeStyle = outline;
      c.lineWidth = 0.2;
      c.beginPath();
      c.moveTo(0.34, -0.5);
      c.bezierCurveTo(0.78, -0.55, 0.76, -0.98, 0.58, -0.94);
      c.stroke();
      c.strokeStyle = col.dark;
      c.lineWidth = 0.13;
      c.beginPath();
      c.moveTo(0.34, -0.5);
      c.bezierCurveTo(0.78, -0.55, 0.76, -0.98, 0.58, -0.94);
      c.stroke();
      c.strokeStyle = col.light;
      c.lineWidth = 0.035;
      c.beginPath();
      c.moveTo(0.4, -0.52);
      c.bezierCurveTo(0.73, -0.6, 0.72, -0.9, 0.61, -0.9);
      c.stroke();
      c.restore();

      // ears
      c.beginPath();
      c.moveTo(-0.38, -1.58);
      c.lineTo(-0.44, -1.98);
      c.lineTo(-0.08, -1.72);
      c.closePath();
      c.fillStyle = col.dark;
      c.fill();
      c.strokeStyle = outline;
      c.lineWidth = lw;
      c.stroke();
      c.beginPath();
      c.moveTo(0.38, -1.58);
      c.lineTo(0.44, -1.98);
      c.lineTo(0.08, -1.72);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(-0.33, -1.66);
      c.lineTo(-0.37, -1.88);
      c.lineTo(-0.16, -1.73);
      c.closePath();
      c.fillStyle = col.blush;
      c.fill();
      c.beginPath();
      c.moveTo(0.33, -1.66);
      c.lineTo(0.37, -1.88);
      c.lineTo(0.16, -1.73);
      c.closePath();
      c.fill();

      eShape(c, -0.22, -0.09, 0.2, 0.13, col.dark, outline, lw);
      eShape(c, 0.22, -0.09, 0.2, 0.13, col.dark, outline, lw);
      eShape(c, -0.45, -0.76, 0.15, 0.31, col.body, outline, lw, -0.22);
      eShape(c, 0.45, -0.76, 0.15, 0.31, col.body, outline, lw, 0.22);

      const body = gradientY(c, -1.12, -0.08, [
        [0, col.light],
        [0.62, col.body],
        [1, col.dark],
      ]);
      eShape(c, 0, -0.64, 0.49, 0.55, body, outline, lw);
      eFill(c, 0, -0.51, 0.3, 0.37, col.cream);

      const head = gradientY(c, -1.82, -0.98, [
        [0, col.light],
        [0.6, col.body],
        [1, col.dark],
      ]);
      cShape(c, 0, -1.35, 0.43, head, outline, lw);

      // forehead stripes
      c.strokeStyle = col.dark;
      c.lineWidth = 0.05;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-0.1, -1.74);
      c.lineTo(-0.12, -1.58);
      c.moveTo(0, -1.77);
      c.lineTo(0, -1.6);
      c.moveTo(0.1, -1.74);
      c.lineTo(0.12, -1.58);
      c.stroke();
      eFill(c, 0, -1.22, 0.2, 0.13, col.cream);
      eFill(c, -0.15, -1.4, 0.05, 0.06, '#6d9c55');
      eFill(c, 0.15, -1.4, 0.05, 0.06, '#6d9c55');
      cFill(c, -0.15, -1.4, 0.018, '#1b2919');
      cFill(c, 0.15, -1.4, 0.018, '#1b2919');
      cFill(c, -0.138, -1.415, 0.008, 'rgba(255,255,255,0.85)');
      cFill(c, 0.162, -1.415, 0.008, 'rgba(255,255,255,0.85)');
      c.beginPath();
      c.moveTo(-0.04, -1.27);
      c.lineTo(0.04, -1.27);
      c.lineTo(0, -1.22);
      c.closePath();
      c.fillStyle = '#d97b79';
      c.fill();
      c.strokeStyle = 'rgba(81, 49, 42, 0.65)';
      c.lineWidth = 0.012;
      c.beginPath();
      c.moveTo(-0.13, -1.23);
      c.lineTo(-0.32, -1.26);
      c.moveTo(-0.13, -1.19);
      c.lineTo(-0.31, -1.16);
      c.moveTo(0.13, -1.23);
      c.lineTo(0.32, -1.26);
      c.moveTo(0.13, -1.19);
      c.lineTo(0.31, -1.16);
      c.stroke();
      eFill(c, -0.31, -1.28, 0.055, 0.03, 'rgba(242, 146, 119, 0.46)');
      eFill(c, 0.31, -1.28, 0.055, 0.03, 'rgba(242, 146, 119, 0.46)');
      eFill(c, -0.14, -1.54, 0.13, 0.052, 'rgba(255, 255, 255, 0.2)');
    }

    if (type === 'doodle') {
      const ink = col.ink;
      const doodleBody = gradientY(c, -1.66, -0.36, [
        [0, col.light],
        [0.68, col.body],
        [1, col.dark],
      ]);

      // Loose ink-line arms with a paper-coloured halo so they read on dark glass.
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const drawDoodleArms = () => {
        c.beginPath();
        c.moveTo(-0.4, -1.02);
        c.bezierCurveTo(-0.73, -0.98, -0.91, -0.78, -0.84, -0.58);
        c.bezierCurveTo(-0.8, -0.45, -0.65, -0.46, -0.67, -0.61);
        c.moveTo(0.4, -1.08);
        c.bezierCurveTo(0.74, -1.12, 0.93, -0.97, 0.89, -0.79);
        c.bezierCurveTo(0.86, -0.64, 0.71, -0.64, 0.74, -0.79);
      };
      c.strokeStyle = col.light;
      c.lineWidth = 0.115;
      drawDoodleArms();
      c.stroke();
      c.strokeStyle = ink;
      c.lineWidth = 0.075;
      drawDoodleArms();
      c.stroke();
      c.restore();

      // Two loop-shaped tufts from the original sketch.
      eShape(c, -0.19, -1.84, 0.16, 0.34, col.light, ink, 0.05, -0.26);
      eShape(c, 0.17, -1.9, 0.155, 0.33, col.light, ink, 0.05, 0.22);
      eShape(c, -0.19, -1.84, 0.085, 0.27, 'rgba(255, 255, 255, 0.42)', null, 0, -0.26);

      // Slightly wobbly round body, so the outline still feels hand-inked.
      const doodleBodyPath = () => {
        const steps = 40;
        c.beginPath();
        for (let i = 0; i < steps; i += 1) {
          const a = (i / steps) * TAU;
          const wobble = 1 + Math.sin(a * 3 + 0.7) * 0.026 + Math.sin(a * 7 - 0.4) * 0.012;
          const x = Math.cos(a) * 0.55 * wobble;
          const y = -1.02 + Math.sin(a) * 0.64 * wobble;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.closePath();
      };
      doodleBodyPath();
      c.fillStyle = doodleBody;
      c.fill();
      c.strokeStyle = ink;
      c.lineWidth = 0.05;
      c.stroke();

      c.save();
      doodleBodyPath();
      c.clip();
      c.strokeStyle = ink;
      c.lineCap = 'round';
      const cx = -0.15;
      const cy = -1.1;
      const dirX = 0.52;
      const dirY = -0.855;
      const perpX = 0.855;
      const perpY = 0.52;
      for (let i = 0; i < 14; i += 1) {
        c.lineWidth = 0.04 + (i % 3) * 0.004;
        const offset = (i - 6.5) * 0.06 + Math.sin((i + 1) * 8.73) * 0.014;
        const sx = cx + perpX * offset - dirX * 0.44;
        const sy = cy + perpY * offset - dirY * 0.44;
        const ex = cx + perpX * offset + dirX * 0.38;
        const ey = cy + perpY * offset + dirY * 0.38;
        const mx = (sx + ex) / 2 + (i % 2 === 0 ? 0.018 : -0.014);
        const my = (sy + ey) / 2 + (i % 3 === 0 ? -0.015 : 0.013);
        c.beginPath();
        c.moveTo(sx, sy);
        c.quadraticCurveTo(mx, my, ex, ey);
        c.stroke();
      }
      // A few shorter strokes rough up the edge of the ink patch.
      c.lineWidth = 0.058;
      for (let i = 0; i < 4; i += 1) {
        const x = -0.38 + i * 0.23;
        c.beginPath();
        c.moveTo(x, -0.5 - (i % 2) * 0.08);
        c.quadraticCurveTo(x + 0.08, -0.62, x + 0.17, -0.55 - (i % 2) * 0.06);
        c.stroke();
      }
      c.restore();

      // Re-ink the body outline so the hatched fill has a crisp edge.
      doodleBodyPath();
      c.strokeStyle = ink;
      c.lineWidth = 0.05;
      c.stroke();

      // Stick legs and scribbled bird feet.
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const drawDoodleLegs = () => {
        c.beginPath();
        c.moveTo(-0.18, -0.41);
        c.lineTo(-0.25, -0.18);
        c.lineTo(-0.3, -0.02);
        c.moveTo(0.18, -0.42);
        c.lineTo(0.28, -0.2);
        c.lineTo(0.33, -0.04);
      };
      const drawDoodleFeet = () => {
        c.beginPath();
        c.moveTo(-0.3, -0.02);
        c.quadraticCurveTo(-0.4, 0.01, -0.45, -0.03);
        c.moveTo(-0.3, -0.02);
        c.quadraticCurveTo(-0.34, 0.04, -0.39, 0.07);
        c.moveTo(-0.3, -0.02);
        c.quadraticCurveTo(-0.25, 0.04, -0.2, 0.05);
        c.moveTo(0.33, -0.04);
        c.quadraticCurveTo(0.44, -0.01, 0.49, -0.05);
        c.moveTo(0.33, -0.04);
        c.quadraticCurveTo(0.36, 0.03, 0.41, 0.05);
        c.moveTo(0.33, -0.04);
        c.quadraticCurveTo(0.27, 0.03, 0.22, 0.04);
      };
      c.strokeStyle = col.light;
      c.lineWidth = 0.085;
      drawDoodleLegs();
      c.stroke();
      c.lineWidth = 0.065;
      drawDoodleFeet();
      c.stroke();
      c.strokeStyle = ink;
      c.lineWidth = 0.055;
      drawDoodleLegs();
      c.stroke();
      c.lineWidth = 0.042;
      drawDoodleFeet();
      c.stroke();
      c.restore();
    }

    if (type === 'star') {
      const body = c.createLinearGradient(0, -1.82, 0, -0.2);
      body.addColorStop(0, col.light);
      body.addColorStop(0.54, col.body);
      body.addColorStop(1, col.dark);
      c.save();
      c.shadowColor = 'rgba(255, 205, 75, 0.5)';
      c.shadowBlur = 0.18;
      starPath(c, 0, -0.98, 0.8, 0.37, 5);
      c.fillStyle = body;
      c.fill();
      c.strokeStyle = 'rgba(115, 69, 14, 0.44)';
      c.lineWidth = lw;
      c.stroke();
      c.restore();

      c.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      c.lineWidth = 0.028;
      c.beginPath();
      c.moveTo(-0.38, -1.25);
      c.quadraticCurveTo(-0.15, -1.5, 0.16, -1.56);
      c.stroke();

      cFill(c, -0.17, -1.02, 0.043, '#5d3b16');
      cFill(c, 0.17, -1.02, 0.043, '#5d3b16');
      cFill(c, -0.157, -1.036, 0.013, 'rgba(255,255,255,0.85)');
      cFill(c, 0.183, -1.036, 0.013, 'rgba(255,255,255,0.85)');
      c.strokeStyle = '#72481b';
      c.lineWidth = 0.016;
      c.beginPath();
      c.moveTo(0, -0.95);
      c.quadraticCurveTo(-0.03, -0.9, -0.07, -0.92);
      c.moveTo(0, -0.95);
      c.quadraticCurveTo(0.03, -0.9, 0.07, -0.92);
      c.stroke();
      eFill(c, -0.3, -0.9, 0.055, 0.03, 'rgba(243, 142, 126, 0.46)');
      eFill(c, 0.3, -0.9, 0.055, 0.03, 'rgba(243, 142, 126, 0.46)');

      drawSparkle(c, 0.5, -1.65, 0.13, '#fff6c6', 0.2);
      drawSparkle(c, -0.49, -1.25, 0.08, 'rgba(255, 246, 198, 0.85)', -0.2);
    }

    c.restore();
  }

  function drawPlushAt(c, type, screenX, screenY, unit, opt = {}) {
    c.save();
    c.translate(screenX, screenY);
    c.scale(unit, unit);
    if (opt.rotate) c.rotate(opt.rotate);
    c.globalAlpha *= opt.alpha == null ? 1 : opt.alpha;
    drawPlushLocal(c, type, opt);
    c.restore();
  }

  function paintMiniCanvases() {
    document.querySelectorAll('canvas.mini-plush').forEach((mini) => {
      const type = mini.dataset.type;
      if (!PLUSH[type]) return;
      const mctx = mini.getContext('2d');
      const size = mini.width;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, size, size);
      const u = size / 2.72;
      mctx.save();
      mctx.translate(size / 2, size * 0.91);
      mctx.scale(u, u);
      drawPlushLocal(mctx, type, { mini: true });
      mctx.restore();
    });
  }

  /* ---------------- Audio ---------------- */

  const Sfx = (() => {
    let audio = null;
    let master = null;
    let muted = false;

    function ensure() {
      if (muted) return null;
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
          audio = new AC();
          master = audio.createGain();
          master.gain.value = 0.6;
          master.connect(audio.destination);
        } catch (e) {
          audio = null;
          return null;
        }
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return audio;
    }

    function tone(freq, dur, opts = {}) {
      if (muted) return;
      const a = ensure();
      if (!a) return;
      const type = opts.type || 'sine';
      const vol = opts.vol == null ? 0.04 : opts.vol;
      const delay = opts.delay || 0;
      const slide = opts.slide || 0;
      const t0 = a.currentTime + delay;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(30, freq), t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.015, dur * 0.25));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.04);
    }

    function noise(dur, vol = 0.03, cutoff = 900, delay = 0) {
      if (muted) return;
      const a = ensure();
      if (!a) return;
      const length = Math.max(1, Math.floor(a.sampleRate * dur));
      const buffer = a.createBuffer(1, length, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const src = a.createBufferSource();
      src.buffer = buffer;
      const filter = a.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = a.createGain();
      const t0 = a.currentTime + delay;
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0);
    }

    return {
      ensure,
      setMuted(v) {
        muted = v;
        if (!v) ensure();
        if (master) master.gain.value = v ? 0 : 0.6;
      },
      isMuted: () => muted,
      click() {
        tone(720, 0.055, { type: 'triangle', vol: 0.018 });
      },
      start() {
        [392, 523.25, 659.25, 783.99].forEach((f, i) =>
          tone(f, 0.24, { type: 'triangle', vol: 0.035, delay: i * 0.075 })
        );
        noise(0.24, 0.018, 1600);
      },
      view() {
        tone(290, 0.13, { type: 'sine', vol: 0.02, slide: 110 });
        tone(640, 0.08, { type: 'triangle', vol: 0.016, delay: 0.04 });
      },
      drop() {
        tone(170, 0.55, { type: 'sawtooth', vol: 0.023, slide: -105 });
        noise(0.5, 0.02, 700);
      },
      clamp() {
        tone(115, 0.1, { type: 'square', vol: 0.018 });
        noise(0.08, 0.025, 1500);
      },
      lift() {
        tone(160, 0.35, { type: 'triangle', vol: 0.016, slide: 90 });
      },
      grab() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          tone(f, 0.22, { type: 'triangle', vol: 0.036, delay: i * 0.065 })
        );
        noise(0.18, 0.022, 2400);
      },
      fail() {
        tone(220, 0.16, { type: 'square', vol: 0.02, slide: -70 });
        tone(164, 0.24, { type: 'sine', vol: 0.025, delay: 0.12, slide: -45 });
      },
      release() {
        tone(880, 0.12, { type: 'sine', vol: 0.025 });
        tone(1174.66, 0.18, { type: 'triangle', vol: 0.022, delay: 0.05 });
      },
      win() {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          tone(f, 0.45, { type: 'triangle', vol: 0.04, delay: i * 0.11 })
        );
      },
      over() {
        [392, 329.63, 261.63].forEach((f, i) =>
          tone(f, 0.35, { type: 'sine', vol: 0.03, delay: i * 0.16 })
        );
      },
      empty() {
        tone(120, 0.16, { type: 'square', vol: 0.016 });
      },
    };
  })();

  /* ---------------- World constants ---------------- */

  const FLOOR = 3.45;
  const CAGE = { x0: -5.08, x1: 5.08, z0: -4.4, z1: 4.4, top: 14.02 };
  const MACHINE = { x0: -5.4, x1: 5.4, z0: -4.7, z1: 4.7 };
  const SIGN = { x0: -5.66, x1: 5.66, z0: -4.92, z1: 4.92, y0: 14.02, y1: 17.12 };
  const CHUTE = { x: 3.36, z: 3.02, r: 0.83 };
  const TRAY = { x: 3.42, z: MACHINE.z1 + 0.04 };
  const CLAW_REST = 12.32;
  const CLAW_LOW = 4.98;
  const CLAW_LIMIT = { x0: -4.02, x1: 4.02, z0: -3.48, z1: 3.48 };
  const GRAB_RADIUS = 1.82;
  const START_COINS = 10;
  const REWARD_COINS = 2;

  const TOY_SPOTS = [
    [-3.33, -2.24],
    [-1.22, -2.78],
    [1.08, -2.4],
    [3.12, -2.06],
    [-3.46, -0.18],
    [-0.98, -0.48],
    [1.52, -0.14],
    [-2.36, 1.7],
    [0.2, 1.84],
    [2.58, 1.16],
  ];

  const VIEW_STARS = Array.from({ length: 92 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.78,
    r: rand(0.4, 1.7),
    p: Math.random() * TAU,
    sp: rand(0.3, 1.3),
    hue: Math.random() < 0.15 ? 'pink' : Math.random() < 0.3 ? 'gold' : 'cyan',
  }));

  const CONFETTI = [];

  /* ---------------- Game state ---------------- */

  let bestScore = 0;
  try {
    bestScore = Number(window.localStorage.getItem('clawverse.best') || 0) || 0;
  } catch (e) {
    bestScore = 0;
  }

  const game = {
    state: 'idle',
    started: false,
    paused: false,
    coins: START_COINS,
    score: 0,
    collection: {},
    toys: [],
    carrying: null,
    falling: [],
    particles: [],
    trayToy: null,
    pendingTray: null,
    trayAge: 99,
    trayPulse: 0,
    claw: {
      x: 0.1,
      z: -0.25,
      y: CLAW_REST,
      open: 1,
      swing: 0,
      shake: 0,
    },
    stateT: 0,
    aimData: null,
    targetToy: null,
    lastGrab: null,
    clock: 0,
    resolvedThisDrop: false,
  };

  let animTime = 0;
  let toastTimer = 0;
  let lastAimUiKey = '';
  let lastDropUiKey = '';
  let lastFpsHud = 0;

  const keys = new Set();
  const joy = { x: 0, y: 0, active: false, pointerId: null };

  /* ---------------- World/entity helpers ---------------- */

  function makeToys() {
    const guaranteed = ['bear', 'bunny', 'penguin', 'duck', 'cat', 'star', 'doodle'];
    const fillerTypes = ['bear', 'bunny', 'penguin', 'duck', 'cat'];
    const filler = [];
    while (filler.length < TOY_SPOTS.length - guaranteed.length) {
      filler.push(fillerTypes[Math.floor(Math.random() * fillerTypes.length)]);
    }
    const pool = guaranteed.concat(filler);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return TOY_SPOTS.map((spot, i) => {
      const type = pool[i];
      const spec = PLUSH[type];
      return {
        id: i,
        type,
        x: spot[0] + rand(-0.14, 0.14),
        z: spot[1] + rand(-0.14, 0.14),
        y: FLOOR,
        scale: rand(0.92, 1.06) * (type === 'star' ? 0.94 : type === 'doodle' ? 0.98 : 1),
        phase: Math.random() * TAU,
        tiltSeed: Math.random() * TAU,
        grip: clamp(spec.grip * rand(0.92, 1.04), 0.6, 1),
        status: 'floor',
        fallT: 0,
        fallVy: 0,
        rot: 0,
      };
    });
  }

  function totalKinds() {
    return PLUSH_ORDER.filter((type) => (game.collection[type] || 0) > 0).length;
  }

  function allCollected() {
    return PLUSH_ORDER.every((type) => (game.collection[type] || 0) > 0);
  }

  function floorToys() {
    return game.toys.filter((toy) => toy.status === 'floor');
  }

  function nearestFloorToy() {
    let best = null;
    let bestDist = Infinity;
    const list = floorToys();
    for (const toy of list) {
      const d = Math.hypot(toy.x - game.claw.x, toy.z - game.claw.z);
      if (d < bestDist) {
        bestDist = d;
        best = toy;
      }
    }
    return { toy: best, dist: bestDist };
  }

  function getGrabChance(toy, dist) {
    if (!toy || !Number.isFinite(dist) || dist > GRAB_RADIUS) return 0;
    const q = 1 - Math.pow(dist / GRAB_RADIUS, 1.25);
    return clamp((0.34 + q * 0.64) * toy.grip, 0.07, 0.97);
  }

  function refreshAim() {
    const near = nearestFloorToy();
    const chance = getGrabChance(near.toy, near.dist);
    game.aimData = {
      toy: near.toy,
      dist: near.toy ? near.dist : null,
      chance,
    };
    game.targetToy = near.toy;
    updateAimReadout();
  }

  function aimQuality(chance) {
    if (chance >= 0.68) return 'good';
    if (chance >= 0.36) return 'warn';
    return 'bad';
  }

  function aimColor(chance) {
    if (chance >= 0.68) return '#79ffc8';
    if (chance >= 0.36) return '#ffd166';
    return '#ff6ab8';
  }

  function syncCarrying() {
    const toy = game.carrying;
    if (!toy) return;
    const sway = Math.sin(game.clock * 3.1 + toy.phase) * 0.075 + game.claw.swing * 0.5;
    toy.x = game.claw.x + sway;
    toy.z = game.claw.z + Math.sin(game.clock * 2.3 + toy.phase) * 0.025;
    toy.y = Math.max(FLOOR, game.claw.y - 2.05);
    toy.rot = -sway * 0.26;
  }

  /* ---------------- HUD ---------------- */

  function setViewLabel(index, silent) {
    viewName.textContent = VIEW_NAMES[index];
    viewButtons.forEach((btn) => {
      const active = Number(btn.dataset.view) === index;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (!silent) Sfx.view();
  }

  function setView(index, silent = false) {
    const next = ((index % 4) + 4) % 4;
    const desired = next * (Math.PI / 2);
    const delta = shortestAngle(desired - CAM.targetAngle);
    CAM.targetAngle += delta;
    CAM.view = next;
    setViewLabel(next, silent);
  }

  function updateDropButton(force = false) {
    const key = `${game.state}:${game.coins}`;
    if (!force && key === lastDropUiKey) return;
    lastDropUiKey = key;

    const labels = {
      idle: ['待机', 'STANDBY'],
      aim: [game.coins > 0 ? '落爪' : '无币', game.coins > 0 ? 'SPACE' : 'NO COIN'],
      down: ['下降', 'DROPPING'],
      clamp: ['抓取', 'GRABBING'],
      up: ['上升', 'LIFTING'],
      carry: ['运送', 'CARRYING'],
      release: ['释放', 'RELEASE'],
      celebrate: ['完成', 'NICE!'],
      turnEnd: ['待机', 'READY'],
      over: ['结束', 'FINISHED'],
    };

    const pair = labels[game.state] || labels.idle;
    dropMain.textContent = pair[0];
    dropSub.textContent = pair[1];
    const busy = !['aim'].includes(game.state);
    const empty = game.state === 'aim' && game.coins <= 0;
    dropBtn.classList.toggle('is-busy', busy);
    dropBtn.classList.toggle('is-empty', empty);
    dropBtn.setAttribute('aria-disabled', game.state !== 'aim' || game.coins <= 0 ? 'true' : 'false');
  }

  function updateAimReadout() {
    let text = '';
    let tone = '';

    if (game.state === 'aim') {
      if (!game.aimData || !game.aimData.toy) {
        text = '移动爪子，对准想要的娃娃';
      } else {
        const toy = game.aimData.toy;
        const chance = game.aimData.chance;
        const pct = Math.round(chance * 100);
        if (chance <= 0) {
          text = `${PLUSH[toy.type].name} · 距离太远，再靠近一点`;
          tone = 'bad';
        } else {
          text = `${PLUSH[toy.type].name} · 对准度 ${pct}%`;
          tone = aimQuality(chance);
        }
      }
    } else {
      const messages = {
        idle: '投入硬币，开始抓娃娃',
        down: '爪子正在下降…',
        clamp: '正在闭合爪子…',
        up: game.carrying ? '抓到了！正在向上回收' : '爪子正在回收…',
        carry: '正在把娃娃送到取物口…',
        release: '娃娃掉进取物口！',
        celebrate: '收入图鉴！',
        turnEnd: '准备下一次落爪…',
        over: '本局结束',
      };
      text = messages[game.state] || '准备下一次落爪…';
      if (game.state === 'up' && game.carrying) tone = 'good';
      if (game.state === 'celebrate') tone = 'good';
    }

    const key = `${text}|${tone}`;
    if (key === lastAimUiKey) return;
    lastAimUiKey = key;
    aimText.textContent = text;
    aimReadout.className = `aim-readout${tone ? ` ${tone}` : ''}`;
  }

  function updateHUD(force = false) {
    coinValue.textContent = String(game.coins);
    scoreValue.textContent = String(game.score).padStart(4, '0');
    PLUSH_ORDER.forEach((type) => {
      const entry = collectionItems.get(type);
      if (!entry) return;
      const count = game.collection[type] || 0;
      entry.count.textContent = String(count);
      entry.item.classList.toggle('complete', count > 0);
    });
    updateDropButton(force);
    updateAimReadout();
  }

  function bump(el, color) {
    if (!el || !el.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { transform: 'scale(1)', color: '' },
        { transform: 'scale(1.22)', color: color || '#79ffc8' },
        { transform: 'scale(1)', color: '' },
      ],
      { duration: 380, easing: 'ease-out' }
    );
  }

  function popCollection(type) {
    const entry = collectionItems.get(type);
    if (!entry) return;
    entry.item.classList.remove('pop');
    void entry.item.offsetWidth;
    entry.item.classList.add('pop');
    window.setTimeout(() => entry.item.classList.remove('pop'), 650);
    bump(entry.count, PLUSH[type].accent);
  }

  function toast(message, tone = '', duration = 1900) {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show${tone ? ` ${tone}` : ''}`;
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  /* ---------------- State transitions ---------------- */

  function setState(state) {
    game.state = state;
    game.stateT = 0;
    updateDropButton(true);
    updateAimReadout();
  }

  function startDrop() {
    if (!game.started || game.paused) return;
    if (game.state !== 'aim') return;
    if (game.coins <= 0) {
      Sfx.empty();
      toast('游戏币用完了，抓中娃娃可以补充游戏币', 'bad', 2200);
      return;
    }

    Sfx.ensure();
    game.coins -= 1;
    game.resolvedThisDrop = false;
    game.lastGrab = null;
    game.claw.open = 1;
    game.claw.shake = 0;
    setState('down');
    updateHUD();
    bump(coinValue, '#ffd166');
    Sfx.drop();
    toast('落爪！', '', 800);
  }

  function resolveGrab() {
    game.resolvedThisDrop = true;
    const near = nearestFloorToy();
    const toy = near.toy;
    const chance = getGrabChance(toy, near.dist);
    const success = !!toy && Math.random() < chance;

    if (success) {
      toy.status = 'carried';
      game.carrying = toy;
      game.lastGrab = { type: toy.type, chance, success: true };
      game.claw.shake = 1;
      syncCarrying();
      Sfx.grab();
      spawnBurst(toy.x, FLOOR + 0.8, toy.z, ['#fff6b0', '#ffd166', '#70f3ff'], 22, 3.6);
      toast(`抓住了「${PLUSH[toy.type].name}」！`, 'good', 1500);
    } else {
      game.carrying = null;
      game.lastGrab = { type: toy ? toy.type : null, chance, success: false };
      game.claw.shake = 1;
      Sfx.fail();
      spawnBurst(game.claw.x, FLOOR + 0.15, game.claw.z, ['#7b8aa8', '#47617e'], 10, 1.8);
      if (!toy) toast('爪子扑空了…调整位置再试试', 'bad', 1600);
      else if (near.dist > GRAB_RADIUS) toast('距离太远，爪子够不到', 'bad', 1600);
      else toast('差一点！娃娃滑掉了…', 'bad', 1600);
    }
    updateAimReadout();
  }

  function awardPrize(toy) {
    const spec = PLUSH[toy.type];
    game.collection[toy.type] = (game.collection[toy.type] || 0) + 1;
    game.score += spec.points;
    game.coins += REWARD_COINS;
    game.pendingTray = toy.type;
    updateHUD(true);
    popCollection(toy.type);
    bump(scoreValue, '#70f3ff');
    spawnBurst(CHUTE.x, FLOOR + 1.1, CHUTE.z, [spec.accent, '#fff6cf', '#70f3ff'], 30, 4.6);
    Sfx.release();
  }

  function releaseCarrying() {
    const toy = game.carrying;
    if (!toy) return;
    toy.status = 'falling';
    toy.fallT = 0;
    toy.fallVy = 1.4;
    game.falling.push(toy);
    game.carrying = null;
    awardPrize(toy);
    toast(`收入图鉴：${PLUSH[toy.type].name} +${PLUSH[toy.type].points} 分 · +${REWARD_COINS} 币`, 'gold', 2200);
  }

  function finishTurn() {
    if (allCollected()) {
      spawnCelebration();
      showEnd(true);
      return;
    }
    if (game.coins <= 0) {
      showEnd(false);
      return;
    }
    game.claw.open = 1;
    game.carrying = null;
    setState('aim');
    refreshAim();
  }

  function resetGame() {
    game.coins = START_COINS;
    game.score = 0;
    game.collection = {};
    PLUSH_ORDER.forEach((type) => {
      game.collection[type] = 0;
    });
    game.toys = makeToys();
    game.carrying = null;
    game.falling = [];
    game.particles = [];
    game.trayToy = null;
    game.pendingTray = null;
    game.trayAge = 99;
    game.trayPulse = 0;
    game.claw.x = 0.1;
    game.claw.z = -0.25;
    game.claw.y = CLAW_REST;
    game.claw.open = 1;
    game.claw.swing = 0;
    game.claw.shake = 0;
    game.aimData = null;
    game.targetToy = null;
    game.lastGrab = null;
    game.resolvedThisDrop = false;
    game.clock = 0;
    game.state = 'idle';
    game.stateT = 0;
    game.started = false;
    game.paused = false;
    CAM.angle = 0;
    CAM.targetAngle = 0;
    CAM.view = 0;
    setViewLabel(0, true);
    updateCamera(0, true);
    updateHUD(true);
    lastAimUiKey = '';
    lastDropUiKey = '';
    clearToast();
    collectionItems.forEach((entry) => {
      entry.item.classList.remove('complete', 'pop');
    });
    CONFETTI.length = 0;
  }

  function startGame() {
    if (game.started && game.state === 'aim') return;
    Sfx.ensure();
    resetGame();
    game.started = true;
    game.paused = false;
    startOverlay.classList.add('is-hidden');
    endOverlay.classList.add('is-hidden');
    setState('aim');
    refreshAim();
    updateHUD(true);
    Sfx.start();
    if (startBtn) startBtn.blur();
    toast('投入 10 枚硬币 · 用四向视角找到目标吧', 'good', 2400);
  }

  function showEnd(win) {
    if (game.state === 'over') return;
    game.state = 'over';
    game.paused = true;
    game.started = true;
    updateDropButton(true);
    keys.clear();

    const kinds = totalKinds();
    const nextBest = Math.max(bestScore, game.score);
    bestScore = nextBest;
    try {
      window.localStorage.setItem('clawverse.best', String(bestScore));
    } catch (e) {
      /* storage is a nice-to-have */
    }

    endBadge.textContent = win ? 'ALL CLEAR' : 'MISSION';
    endTitle.textContent = win ? '全图鉴达成！' : '游戏币用完了';
    endText.textContent = win
      ? `七款娃娃全部收入囊中，连手绘涂鸦鸡也被你抓到了。你一共获得 ${game.score} 分，是这台机器的传奇玩家。`
      : `这次拿到了 ${game.score} 分。换个视角、对准一点，下一次一定能把喜欢的娃娃带回家。`;
    endScore.textContent = String(game.score);
    endCollected.textContent = `${kinds} / ${PLUSH_ORDER.length}`;
    endBest.textContent = String(bestScore);
    endOverlay.classList.remove('is-hidden');
    if (win) Sfx.win();
    else Sfx.over();
  }

  function spawnCelebration() {
    for (let i = 0; i < 70; i += 1) {
      CONFETTI.push({
        x: Math.random() * W,
        y: -20 - Math.random() * H * 0.35,
        vx: rand(-40, 40),
        vy: rand(60, 180),
        rot: rand(0, TAU),
        vr: rand(-4, 4),
        w: rand(4, 9),
        h: rand(7, 14),
        color: ['#70f3ff', '#ff5fd2', '#ffd166', '#79ffc8', '#a88bff'][Math.floor(Math.random() * 5)],
        life: rand(2.4, 4.5),
      });
    }
  }

  /* ---------------- Particles ---------------- */

  function spawnBurst(x, y, z, colors, count = 16, power = 3) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * TAU;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const speed = rand(power * 0.25, power);
      game.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * Math.cos(b) * speed,
        vy: Math.abs(Math.sin(b)) * speed + rand(0.2, 1.4),
        vz: Math.sin(a) * Math.cos(b) * speed,
        life: rand(0.45, 1.15),
        maxLife: 1.15,
        size: rand(0.035, 0.09),
        color: colors[Math.floor(Math.random() * colors.length)],
        star: Math.random() < 0.35,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i -= 1) {
      const p = game.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        game.particles.splice(i, 1);
        continue;
      }
      p.vy -= 3.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.985;
      p.vz *= 0.985;
    }
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.particles) {
      const pt = projectPoint(p.x, p.y, p.z);
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      const r = Math.max(1.2, p.size * pt.s);
      ctx.globalAlpha = alpha;
      if (p.star) {
        ctx.save();
        ctx.translate(pt.x, pt.y);
        drawSparkle(ctx, 0, 0, r * 1.8, p.color, p.life * 5);
        ctx.restore();
      } else {
        cFill(ctx, pt.x, pt.y, r, p.color);
      }
    }
    ctx.restore();
  }

  function updateConfetti(dt) {
    for (let i = CONFETTI.length - 1; i >= 0; i -= 1) {
      const c = CONFETTI[i];
      c.life -= dt;
      if (c.life <= 0) {
        CONFETTI.splice(i, 1);
        continue;
      }
      c.vy += 24 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      if (c.y > H + 30) {
        c.y = -20;
        c.vy *= 0.6;
      }
    }
  }

  function drawConfetti() {
    if (!CONFETTI.length) return;
    ctx.save();
    for (const c of CONFETTI) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = clamp(c.life, 0, 1);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---------------- Input ---------------- */

  function getMoveInput() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
    x += joy.x;
    y += joy.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  function moveClaw(dt) {
    const input = getMoveInput();
    const magnitude = Math.min(1, Math.hypot(input.x, input.y));
    const a = CAM.angle;
    const rightX = Math.cos(a);
    const rightZ = -Math.sin(a);
    const fwdX = -Math.sin(a);
    const fwdZ = -Math.cos(a);

    if (magnitude > 0.03) {
      let dx = rightX * input.x + fwdX * input.y;
      let dz = rightZ * input.x + fwdZ * input.y;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const speed = 4.9;
      game.claw.x += dx * speed * magnitude * dt;
      game.claw.z += dz * speed * magnitude * dt;
      game.claw.swing = damp(game.claw.swing, -input.x * 0.15, 8, dt);
    } else {
      game.claw.swing = damp(game.claw.swing, 0, 6, dt);
    }

    game.claw.x = clamp(game.claw.x, CLAW_LIMIT.x0, CLAW_LIMIT.x1);
    game.claw.z = clamp(game.claw.z, CLAW_LIMIT.z0, CLAW_LIMIT.z1);
    game.claw.y = CLAW_REST;
  }

  function setJoyVisual(x, y) {
    const travel = joystick.clientWidth * 0.23;
    joyKnob.style.transform = `translate(calc(-50% + ${x * travel}px), calc(-50% + ${y * travel}px))`;
  }

  function updateJoyFromEvent(e) {
    const rect = joystick.getBoundingClientRect();
    let dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    joy.x = dx;
    joy.y = -dy;
    setJoyVisual(dx, dy);
  }

  function resetJoy() {
    joy.active = false;
    joy.pointerId = null;
    joy.x = 0;
    joy.y = 0;
    joystick.classList.remove('active');
    setJoyVisual(0, 0);
  }

  joystick.addEventListener('pointerdown', (e) => {
    if (!game.started || game.paused) return;
    e.preventDefault();
    Sfx.ensure();
    joy.active = true;
    joy.pointerId = e.pointerId;
    joystick.classList.add('active');
    joystick.setPointerCapture(e.pointerId);
    updateJoyFromEvent(e);
  });

  joystick.addEventListener('pointermove', (e) => {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    e.preventDefault();
    updateJoyFromEvent(e);
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => {
    joystick.addEventListener(name, (e) => {
      if (joy.pointerId != null && e.pointerId !== joy.pointerId) return;
      resetJoy();
    });
  });

  window.addEventListener('keydown', (e) => {
    const isMovement = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'Space',
    ].includes(e.code);

    if (isMovement) e.preventDefault();

    if (!game.started) {
      if ((e.code === 'Space' || e.code === 'Enter') && !startOverlay.classList.contains('is-hidden')) {
        startGame();
        return;
      }
      return;
    }

    if (e.code === 'Escape') {
      if (!helpOverlay.classList.contains('is-hidden')) closeHelp();
      return;
    }

    if (!helpOverlay.classList.contains('is-hidden')) return;

    if (e.code === 'Space' && !e.repeat) {
      startDrop();
      return;
    }
    if (!e.repeat && (e.code === 'KeyQ' || e.code === 'KeyE')) {
      const dir = e.code === 'KeyQ' ? -1 : 1;
      setView(CAM.view + dir);
      return;
    }
    if (!e.repeat && /^Digit[1-4]$/.test(e.code)) {
      setView(Number(e.code.slice(5)) - 1);
      return;
    }

    keys.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    resetJoy();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      keys.clear();
      resetJoy();
    }
  });

  dropBtn.addEventListener('click', () => {
    Sfx.ensure();
    if (game.state === 'aim') startDrop();
  });

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      Sfx.ensure();
      setView(Number(btn.dataset.view));
    });
  });

  soundBtn.addEventListener('click', () => {
    const nextMuted = !Sfx.isMuted();
    Sfx.setMuted(nextMuted);
    soundBtn.classList.toggle('is-muted', nextMuted);
    soundBtn.setAttribute('aria-pressed', String(!nextMuted));
    soundBtn.setAttribute('aria-label', nextMuted ? '开启音效' : '关闭音效');
    soundBtn.title = nextMuted ? '开启音效' : '关闭音效';
    if (!nextMuted) Sfx.click();
  });

  startBtn.addEventListener('click', startGame);

  againBtn.addEventListener('click', () => {
    endOverlay.classList.add('is-hidden');
    game.paused = false;
    startGame();
  });

  function openHelp() {
    if (!game.started) return;
    game.paused = true;
    keys.clear();
    resetJoy();
    helpOverlay.classList.remove('is-hidden');
    helpClose.focus();
  }

  function closeHelp() {
    helpOverlay.classList.add('is-hidden');
    if (game.state !== 'over') game.paused = false;
    Sfx.click();
  }

  helpBtn.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);
  helpResume.addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) closeHelp();
  });

  function clearToast() {
    window.clearTimeout(toastTimer);
    toastEl.className = 'toast';
    toastEl.textContent = '';
  }

  /* ---------------- Simulation ---------------- */

  function updateGame(dt) {
    if (!game.started) return;
    game.clock += dt;

    if (game.paused) return;

    if (game.trayToy) {
      game.trayAge += dt;
      game.trayPulse = Math.max(0, game.trayPulse - dt * 1.6);
    }

    updateParticles(dt);
    game.claw.shake = damp(game.claw.shake, 0, 5.5, dt);

    if (game.state === 'idle' || game.state === 'over') return;

    game.stateT += dt;

    if (game.state === 'aim') {
      moveClaw(dt);
      refreshAim();
      return;
    }

    if (game.state === 'down') {
      game.claw.y -= 7.2 * dt;
      game.claw.open = damp(game.claw.open, 1, 18, dt);
      game.claw.shake = Math.max(game.claw.shake, 0.18);
      if (game.claw.y <= CLAW_LOW) {
        game.claw.y = CLAW_LOW;
        game.claw.shake = 0.6;
        setState('clamp');
        Sfx.clamp();
      }
      return;
    }

    if (game.state === 'clamp') {
      game.claw.open = damp(game.claw.open, 0.04, 13, dt);
      if (game.stateT >= 0.28 && !game.resolvedThisDrop) resolveGrab();
      if (game.stateT >= 0.56) {
        setState('up');
        if (game.carrying) Sfx.lift();
      }
      return;
    }

    if (game.state === 'up') {
      game.claw.y += 6.9 * dt;
      game.claw.open = damp(game.claw.open, 0.04, 15, dt);
      syncCarrying();
      if (game.claw.y >= CLAW_REST) {
        game.claw.y = CLAW_REST;
        if (game.carrying) {
          setState('carry');
        } else {
          setState('turnEnd');
          game.claw.open = 1;
        }
      }
      return;
    }

    if (game.state === 'carry') {
      const travel = 1.08;
      const t = clamp(game.stateT / travel, 0, 1);
      game.claw.x = damp(game.claw.x, CHUTE.x, 5.5, dt);
      game.claw.z = damp(game.claw.z, CHUTE.z, 5.5, dt);
      if (t >= 1) {
        game.claw.x = CHUTE.x;
        game.claw.z = CHUTE.z;
        setState('release');
        game.claw.open = Math.max(0.04, game.claw.open);
      }
      syncCarrying();
      return;
    }

    if (game.state === 'release') {
      game.claw.x = damp(game.claw.x, CHUTE.x, 8, dt);
      game.claw.z = damp(game.claw.z, CHUTE.z, 8, dt);
      game.claw.open = Math.min(1, game.claw.open + dt * 3.6);
      syncCarrying();
      if (game.stateT >= 0.34 && game.carrying) releaseCarrying();
      if (game.stateT >= 1.02) {
        setState('celebrate');
      }
      return;
    }

    if (game.state === 'celebrate') {
      game.claw.x = damp(game.claw.x, 0.1, 2.5, dt);
      game.claw.z = damp(game.claw.z, -0.25, 2.5, dt);
      game.claw.y = damp(game.claw.y, CLAW_REST, 2.5, dt);
      game.claw.open = Math.min(1, game.claw.open + dt * 2.5);
      if (game.stateT >= 1.55) finishTurn();
      return;
    }

    if (game.state === 'turnEnd') {
      if (game.stateT >= 0.55) finishTurn();
    }
  }

  function updateFalling(dt) {
    if (!game.started || game.paused) return;
    for (let i = game.falling.length - 1; i >= 0; i -= 1) {
      const toy = game.falling[i];
      toy.fallT += dt;
      toy.fallVy += 23 * dt;
      toy.y -= toy.fallVy * dt;
      toy.rot += dt * 3.4;
      if (toy.fallT > 0.9 && game.pendingTray) {
        game.trayToy = game.pendingTray;
        game.pendingTray = null;
        game.trayAge = 0;
        game.trayPulse = 1;
      }
      if (toy.fallT > 1.2) {
        game.falling.splice(i, 1);
      }
    }
  }

  /* ---------------- Scene drawing ---------------- */

  function drawBackdrop(t) {
    ctx.fillStyle = '#03040c';
    ctx.fillRect(0, 0, W, H);

    let g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070a1a');
    g.addColorStop(0.46, '#0a1024');
    g.addColorStop(0.78, '#070b19');
    g.addColorStop(1, '#03050d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // A soft nebula behind the cabinet.
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.38, Math.max(W, H) * 0.66);
    rg.addColorStop(0, 'rgba(76, 52, 145, 0.2)');
    rg.addColorStop(0.45, 'rgba(30, 62, 135, 0.08)');
    rg.addColorStop(1, 'rgba(3, 5, 13, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    const pinkGlow = ctx.createRadialGradient(W * 0.22, H * 0.54, 0, W * 0.22, H * 0.54, W * 0.3);
    pinkGlow.addColorStop(0, 'rgba(255, 49, 158, 0.055)');
    pinkGlow.addColorStop(1, 'rgba(255, 49, 158, 0)');
    ctx.fillStyle = pinkGlow;
    ctx.fillRect(0, 0, W, H);

    if (CONFETTI.length) {
      // The sky still sparkles through the confetti.
    }

    for (const star of VIEW_STARS) {
      const a = 0.18 + 0.36 * (0.5 + 0.5 * Math.sin(t * star.sp + star.p));
      const color =
        star.hue === 'pink'
          ? `rgba(255, 127, 219, ${a})`
          : star.hue === 'gold'
            ? `rgba(255, 215, 120, ${a})`
            : `rgba(150, 235, 255, ${a})`;
      cFill(ctx, star.x * W, star.y * H, star.r, color);
    }

    // Ground plane grid — simple but effective 3D grounding.
    ctx.save();
    for (let x = -16; x <= 16; x += 2) {
      drawLine3D({ x, y: 0, z: -15 }, { x, y: 0, z: 15 }, {
        color: 'rgba(95, 142, 200, 0.11)',
        width: 0.007,
        alpha: 0.58,
      });
    }
    for (let z = -15; z <= 15; z += 2) {
      drawLine3D({ x: -16, y: 0, z }, { x: 16, y: 0, z }, {
        color: 'rgba(95, 142, 200, 0.11)',
        width: 0.007,
        alpha: 0.58,
      });
    }
    ctx.restore();

    const stage = projectPoint(0, 0, 0);
    const stageR = Math.max(30, 7.8 * stage.s);
    const stageGrad = ctx.createRadialGradient(stage.x, stage.y - stageR * 0.1, 0, stage.x, stage.y, stageR);
    stageGrad.addColorStop(0, 'rgba(70, 180, 225, 0.12)');
    stageGrad.addColorStop(0.38, 'rgba(40, 100, 180, 0.07)');
    stageGrad.addColorStop(0.7, 'rgba(255, 53, 157, 0.035)');
    stageGrad.addColorStop(1, 'rgba(255, 53, 157, 0)');
    ctx.fillStyle = stageGrad;
    ctx.fillRect(0, 0, W, H);

    // stage rim
    const rim = projectCircle(0, 0, 7.2, 0.015, 48);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(112, 243, 255, 0.1)';
    ctx.lineWidth = 1.2;
    pathPoints(rim);
    ctx.stroke();
    ctx.restore();

    // A subtle back light halo to pop the marquee.
    const halo = ctx.createRadialGradient(W * 0.5, H * 0.22, 0, W * 0.5, H * 0.22, W * 0.32);
    halo.addColorStop(0, 'rgba(255, 69, 170, 0.06)');
    halo.addColorStop(1, 'rgba(255, 69, 170, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
  }

  function boxFaces(box) {
    const { x0, x1, y0, y1, z0, z1 } = box;
    return [
      { name: 'front', normal: { x: 0, y: 0, z: 1 }, pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
      { name: 'back', normal: { x: 0, y: 0, z: -1 }, pts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
      { name: 'left', normal: { x: -1, y: 0, z: 0 }, pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
      { name: 'right', normal: { x: 1, y: 0, z: 0 }, pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
      { name: 'top', normal: { x: 0, y: 1, z: 0 }, pts: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
      { name: 'bottom', normal: { x: 0, y: -1, z: 0 }, pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    ];
  }

  function faceCenter(face) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of face.pts) {
      x += p[0];
      y += p[1];
      z += p[2];
    }
    return { x: x / 4, y: y / 4, z: z / 4 };
  }

  function faceVisible(face) {
    const center = faceCenter(face);
    return dot3(face.normal, {
      x: CAM.eye.x - center.x,
      y: CAM.eye.y - center.y,
      z: CAM.eye.z - center.z,
    }) > 0.0001;
  }

  function drawBox3D(box, palette, opt = {}) {
    const faces = boxFaces(box);
    const visible = [];
    for (const face of faces) {
      if (!faceVisible(face)) continue;
      const projected = face.pts.map((p) => projectPoint(p[0], p[1], p[2]));
      const depth = projected.reduce((sum, p) => sum + p.d, 0) / 4;
      visible.push({ ...face, projected, depth, center: faceCenter(face) });
    }
    visible.sort((a, b) => b.depth - a.depth);
    for (const face of visible) {
      poly(face.projected, palette[face.name] || palette.default, opt.stroke || 'rgba(4, 8, 18, 0.55)', opt.lineWidth || 1);
      if (opt.rim) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        line(
          [face.projected[0], face.projected[1]],
          'rgba(180, 240, 255, 0.7)',
          opt.rim
        );
        ctx.restore();
      }
    }
  }

  function drawBase(t) {
    // plinth
    drawBox3D(
      { x0: MACHINE.x0 - 0.18, x1: MACHINE.x1 + 0.18, y0: 0, y1: 0.48, z0: MACHINE.z0 - 0.16, z1: MACHINE.z1 + 0.16 },
      {
        front: '#0c1531',
        back: '#070c1b',
        left: '#091027',
        right: '#0b142e',
        top: '#16244d',
        bottom: '#02040b',
        default: '#0c1531',
      },
      { stroke: 'rgba(1, 3, 9, 0.6)' }
    );

    drawBox3D(
      { x0: MACHINE.x0, x1: MACHINE.x1, y0: 0.48, y1: FLOOR, z0: MACHINE.z0, z1: MACHINE.z1 },
      {
        front: '#16264e',
        back: '#0a1228',
        left: '#0d1938',
        right: '#112044',
        top: '#1b2d59',
        bottom: '#03050d',
        default: '#132143',
      },
      { stroke: 'rgba(2, 5, 12, 0.62)' }
    );

    const frontNormal = { x: 0, y: 0, z: 1 };
    const frontCenter = { x: 0, y: 2, z: MACHINE.z1 };
    const frontVisible = dot3(frontNormal, {
      x: CAM.eye.x - frontCenter.x,
      y: CAM.eye.y - frontCenter.y,
      z: CAM.eye.z - frontCenter.z,
    }) > 0;
    const rightVisible = CAM.eye.x > MACHINE.x1;
    const leftVisible = CAM.eye.x < MACHINE.x0;
    const backVisible = CAM.eye.z < MACHINE.z0;

    // Neon strips around the base.
    const neonY = 2.92;
    if (frontVisible) {
      drawNeonLine({ x: MACHINE.x0 + 0.1, y: neonY, z: MACHINE.z1 + 0.015 }, { x: MACHINE.x1 - 0.1, y: neonY, z: MACHINE.z1 + 0.015 }, '#ff5fd2', 0.012, 0.75);
      drawNeonLine({ x: MACHINE.x0 + 0.1, y: 0.62, z: MACHINE.z1 + 0.015 }, { x: MACHINE.x1 - 0.1, y: 0.62, z: MACHINE.z1 + 0.015 }, '#70f3ff', 0.009, 0.55);
    }
    if (rightVisible) {
      drawNeonLine({ x: MACHINE.x1 + 0.015, y: neonY, z: MACHINE.z0 + 0.1 }, { x: MACHINE.x1 + 0.015, y: neonY, z: MACHINE.z1 - 0.1 }, '#ff5fd2', 0.012, 0.62);
    }
    if (leftVisible) {
      drawNeonLine({ x: MACHINE.x0 - 0.015, y: neonY, z: MACHINE.z1 - 0.1 }, { x: MACHINE.x0 - 0.015, y: neonY, z: MACHINE.z0 + 0.1 }, '#ff5fd2', 0.012, 0.62);
    }
    if (backVisible) {
      drawNeonLine({ x: MACHINE.x1 - 0.1, y: neonY, z: MACHINE.z0 - 0.015 }, { x: MACHINE.x0 + 0.1, y: neonY, z: MACHINE.z0 - 0.015 }, '#70f3ff', 0.009, 0.4);
    }

    // Vertical corner light accents.
    if (frontVisible) {
      drawNeonLine({ x: MACHINE.x0 + 0.22, y: 0.66, z: MACHINE.z1 + 0.018 }, { x: MACHINE.x0 + 0.22, y: 2.8, z: MACHINE.z1 + 0.018 }, '#70f3ff', 0.006, 0.34);
      drawNeonLine({ x: MACHINE.x1 - 0.22, y: 0.66, z: MACHINE.z1 + 0.018 }, { x: MACHINE.x1 - 0.22, y: 2.8, z: MACHINE.z1 + 0.018 }, '#70f3ff', 0.006, 0.34);
    }

    if (frontVisible) {
      // Coin panel.
      drawQuad3D(
        [
          [-4.72, 0.83, MACHINE.z1 + 0.018],
          [-2.98, 0.83, MACHINE.z1 + 0.018],
          [-2.98, 2.38, MACHINE.z1 + 0.018],
          [-4.72, 2.38, MACHINE.z1 + 0.018],
        ],
        'rgba(4, 9, 22, 0.92)',
        'rgba(112, 243, 255, 0.28)',
        1
      );
      drawQuad3D(
        [
          [-4.55, 1.0, MACHINE.z1 + 0.022],
          [-3.15, 1.0, MACHINE.z1 + 0.022],
          [-3.15, 2.18, MACHINE.z1 + 0.022],
          [-4.55, 2.18, MACHINE.z1 + 0.022],
        ],
        'rgba(9, 19, 42, 0.8)',
        'rgba(112, 243, 255, 0.1)',
        1
      );

      const slotTop = projectPoint(-3.86, 1.92, MACHINE.z1 + 0.03);
      const slotBottom = projectPoint(-3.86, 1.42, MACHINE.z1 + 0.03);
      const slotUnit = (slotTop.s + slotBottom.s) * 0.5;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.72)';
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 8;
      ctx.lineWidth = Math.max(1, 0.035 * slotUnit);
      ctx.beginPath();
      ctx.moveTo(slotTop.x, slotTop.y);
      ctx.lineTo(slotBottom.x, slotBottom.y);
      ctx.stroke();
      ctx.restore();

      const coinText = projectPoint(-3.86, 1.16, MACHINE.z1 + 0.032);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 232, 165, 0.72)';
      ctx.font = `700 ${Math.max(7, 0.16 * coinText.s)}px ${DISPLAY_FONT}`;
      ctx.fillText('COIN', coinText.x, coinText.y);
      ctx.restore();

      // The prize tray is the visual destination of a successful grab.
      drawQuad3D(
        [
          [1.62, 0.72, MACHINE.z1 + 0.02],
          [4.98, 0.72, MACHINE.z1 + 0.02],
          [4.98, 2.47, MACHINE.z1 + 0.02],
          [1.62, 2.47, MACHINE.z1 + 0.02],
        ],
        'rgba(2, 5, 14, 0.97)',
        'rgba(255, 95, 210, 0.48)',
        1.2,
        'rgba(255, 95, 210, 0.45)'
      );
      drawQuad3D(
        [
          [1.82, 0.9, MACHINE.z1 + 0.026],
          [4.78, 0.9, MACHINE.z1 + 0.026],
          [4.78, 2.27, MACHINE.z1 + 0.026],
          [1.82, 2.27, MACHINE.z1 + 0.026],
        ],
        'rgba(5, 10, 23, 0.7)',
        'rgba(112, 243, 255, 0.12)',
        1
      );
      const prizeText = projectPoint(3.3, 2.3, MACHINE.z1 + 0.035);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 154, 222, 0.75)';
      ctx.font = `700 ${Math.max(6.5, 0.15 * prizeText.s)}px ${DISPLAY_FONT}`;
      ctx.fillText('P R I Z E', prizeText.x, prizeText.y);
      ctx.restore();

      // A few tiny status LEDs on the control panel.
      for (let i = 0; i < 3; i += 1) {
        const led = projectPoint(-4.25 + i * 0.34, 0.98, MACHINE.z1 + 0.03);
        cFill(ctx, led.x, led.y, Math.max(1, 0.025 * led.s), i === 1 ? '#79ffc8' : 'rgba(112, 243, 255, 0.6)');
      }
    }

    if (backVisible) {
      // Rear service panel, so the back view is not a blank slab.
      drawQuad3D(
        [
          [-3.7, 0.9, MACHINE.z0 - 0.02],
          [3.7, 0.9, MACHINE.z0 - 0.02],
          [3.7, 2.56, MACHINE.z0 - 0.02],
          [-3.7, 2.56, MACHINE.z0 - 0.02],
        ],
        'rgba(4, 8, 20, 0.9)',
        'rgba(112, 243, 255, 0.24)',
        1
      );
      for (let i = 0; i < 4; i += 1) {
        const y = 1.12 + i * 0.22;
        drawLine3D(
          { x: -3.4, y, z: MACHINE.z0 - 0.03 },
          { x: 3.4, y, z: MACHINE.z0 - 0.03 },
          { color: 'rgba(112, 243, 255, 0.1)', width: 0.008 }
        );
      }
      const backStar = projectPoint(0, 2.05, MACHINE.z0 - 0.035);
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawSparkle(ctx, backStar.x, backStar.y, Math.max(2, 0.16 * backStar.s), 'rgba(255, 95, 210, 0.8)', 0);
      ctx.restore();
    }

    if (rightVisible || leftVisible) {
      const sideX = rightVisible ? MACHINE.x1 + 0.02 : MACHINE.x0 - 0.02;
      drawQuad3D(
        [
          [sideX, 0.82, -2.75],
          [sideX, 0.82, 2.75],
          [sideX, 2.54, 2.75],
          [sideX, 2.54, -2.75],
        ],
        'rgba(4, 8, 20, 0.78)',
        'rgba(112, 243, 255, 0.16)',
        1
      );
      for (let i = 0; i < 3; i += 1) {
        const y = 1.12 + i * 0.24;
        drawLine3D(
          { x: sideX, y, z: -2.45 },
          { x: sideX, y, z: 2.45 },
          { color: 'rgba(112, 243, 255, 0.08)', width: 0.008 }
        );
      }
    }

    // A bevel highlight where the base meets the glass.
    const bevel = [
      [MACHINE.x0, FLOOR - 0.04, MACHINE.z1 + 0.012],
      [MACHINE.x1, FLOOR - 0.04, MACHINE.z1 + 0.012],
    ];
    if (frontVisible) {
      drawLine3D({ x: bevel[0][0], y: bevel[0][1], z: bevel[0][2] }, { x: bevel[1][0], y: bevel[1][1], z: bevel[1][2] }, {
        color: 'rgba(180, 245, 255, 0.18)',
        width: 0.012,
      });
    }
  }

  function getCageHull() {
    const points = [];
    for (const y of [FLOOR, CAGE.top]) {
      for (const x of [CAGE.x0, CAGE.x1]) {
        for (const z of [CAGE.z0, CAGE.z1]) {
          points.push(projectPoint(x, y, z));
        }
      }
    }
    return convexHull(points);
  }

  function drawFarWalls(t) {
    const walls = [
      {
        pts: [[CAGE.x0, FLOOR, CAGE.z0], [CAGE.x1, FLOOR, CAGE.z0], [CAGE.x1, CAGE.top, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z0]],
        normal: { x: 0, y: 0, z: -1 },
        center: { x: 0, y: 8.7, z: CAGE.z0 },
        star: { x: 0, y: 9.1, z: CAGE.z0 + 0.015 },
        accent: 'rgba(255, 95, 210, 0.22)',
      },
      {
        pts: [[CAGE.x0, FLOOR, CAGE.z1], [CAGE.x1, FLOOR, CAGE.z1], [CAGE.x1, CAGE.top, CAGE.z1], [CAGE.x0, CAGE.top, CAGE.z1]],
        normal: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 8.7, z: CAGE.z1 },
        star: { x: 0, y: 9.1, z: CAGE.z1 - 0.015 },
        accent: 'rgba(255, 95, 210, 0.22)',
      },
      {
        pts: [[CAGE.x1, FLOOR, CAGE.z1], [CAGE.x1, FLOOR, CAGE.z0], [CAGE.x1, CAGE.top, CAGE.z0], [CAGE.x1, CAGE.top, CAGE.z1]],
        normal: { x: 1, y: 0, z: 0 },
        center: { x: CAGE.x1, y: 8.7, z: 0 },
        star: { x: CAGE.x1 - 0.015, y: 9.1, z: 0 },
        accent: 'rgba(112, 243, 255, 0.2)',
      },
      {
        pts: [[CAGE.x0, FLOOR, CAGE.z1], [CAGE.x0, FLOOR, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z1]],
        normal: { x: -1, y: 0, z: 0 },
        center: { x: CAGE.x0, y: 8.7, z: 0 },
        star: { x: CAGE.x0 + 0.015, y: 9.1, z: 0 },
        accent: 'rgba(112, 243, 255, 0.2)',
      },
    ];

    for (const wall of walls) {
      const toEye = {
        x: CAM.eye.x - wall.center.x,
        y: CAM.eye.y - wall.center.y,
        z: CAM.eye.z - wall.center.z,
      };
      const wallFacing = dot3(wall.normal, toEye) / (Math.hypot(toEye.x, toEye.y, toEye.z) || 1);
      if (wallFacing > -0.18) continue;

      const projected = wall.pts.map((p) => projectPoint(p[0], p[1], p[2]));
      const top = Math.min(...projected.map((p) => p.y));
      const bottom = Math.max(...projected.map((p) => p.y));
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, 'rgba(10, 22, 51, 0.64)');
      grad.addColorStop(0.62, 'rgba(7, 15, 36, 0.79)');
      grad.addColorStop(1, 'rgba(4, 9, 24, 0.86)');
      poly(projected, grad, null);

      // A soft panel seam near the bottom of each wall.
      const seamY = FLOOR + 0.65;
      const seamPts = [
        wall.pts[0],
        wall.pts[1],
      ];
      drawLine3D(
        { x: seamPts[0][0], y: seamY, z: seamPts[0][2] },
        { x: seamPts[1][0], y: seamY, z: seamPts[1][2] },
        { color: 'rgba(112, 243, 255, 0.09)', width: 0.018 }
      );

      const star = projectPoint(wall.star.x, wall.star.y, wall.star.z);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.1 * Math.sin(t * 1.4 + wall.star.x);
      drawSparkle(ctx, star.x, star.y, Math.max(3, 0.38 * star.s), wall.accent, 0);
      ctx.restore();

      const label = projectPoint(wall.star.x, wall.star.y - 0.62, wall.star.z);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(150, 220, 255, 0.17)';
      ctx.font = `700 ${Math.max(6, 0.17 * label.s)}px ${DISPLAY_FONT}`;
      ctx.fillText('L U C K Y', label.x, label.y);
      ctx.restore();

      // Neon edging catches the glass.
      const topLeft = wall.pts[3];
      const topRight = wall.pts[2];
      const bottomLeft = wall.pts[0];
      const bottomRight = wall.pts[1];
      drawNeonLine(
        { x: topLeft[0], y: topLeft[1], z: topLeft[2] },
        { x: bottomLeft[0], y: bottomLeft[1], z: bottomLeft[2] },
        '#70f3ff',
        0.006,
        0.28
      );
      drawNeonLine(
        { x: topRight[0], y: topRight[1], z: topRight[2] },
        { x: bottomRight[0], y: bottomRight[1], z: bottomRight[2] },
        '#70f3ff',
        0.006,
        0.28
      );
    }
  }

  function drawInteriorFloor(t) {
    const floorPoints = [
      [CAGE.x0 + 0.02, FLOOR, CAGE.z1 - 0.02],
      [CAGE.x1 - 0.02, FLOOR, CAGE.z1 - 0.02],
      [CAGE.x1 - 0.02, FLOOR, CAGE.z0 + 0.02],
      [CAGE.x0 + 0.02, FLOOR, CAGE.z0 + 0.02],
    ];
    const projected = floorPoints.map((p) => projectPoint(p[0], p[1], p[2]));
    const top = Math.min(...projected.map((p) => p.y));
    const bottom = Math.max(...projected.map((p) => p.y));
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, 'rgba(15, 34, 64, 0.92)');
    g.addColorStop(0.52, 'rgba(8, 20, 43, 0.97)');
    g.addColorStop(1, 'rgba(4, 10, 26, 0.99)');
    poly(projected, g, 'rgba(112, 243, 255, 0.15)', 1);

    // Floor grid.
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let x = -4.4; x <= 4.4; x += 0.8) {
      drawLine3D({ x, y: FLOOR + 0.006, z: CAGE.z0 + 0.06 }, { x, y: FLOOR + 0.006, z: CAGE.z1 - 0.06 }, {
        color: 'rgba(112, 243, 255, 0.1)',
        width: 0.006,
      });
    }
    for (let z = -3.9; z <= 3.9; z += 0.8) {
      drawLine3D({ x: CAGE.x0 + 0.06, y: FLOOR + 0.006, z }, { x: CAGE.x1 - 0.06, y: FLOOR + 0.006, z }, {
        color: 'rgba(112, 243, 255, 0.08)',
        width: 0.006,
      });
    }
    ctx.restore();

    // A cool reflection pool at the center of the floor.
    const center = projectPoint(0, FLOOR + 0.012, 0);
    const floorGlow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(20, 4.9 * center.s));
    floorGlow.addColorStop(0, 'rgba(112, 243, 255, 0.055)');
    floorGlow.addColorStop(0.6, 'rgba(92, 91, 220, 0.025)');
    floorGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, 0, W, H);

    // Floor perimeter lights.
    drawNeonLine({ x: CAGE.x0 + 0.05, y: FLOOR + 0.01, z: CAGE.z1 - 0.05 }, { x: CAGE.x1 - 0.05, y: FLOOR + 0.01, z: CAGE.z1 - 0.05 }, '#70f3ff', 0.006, 0.36);
    drawNeonLine({ x: CAGE.x1 - 0.05, y: FLOOR + 0.01, z: CAGE.z1 - 0.05 }, { x: CAGE.x1 - 0.05, y: FLOOR + 0.01, z: CAGE.z0 + 0.05 }, '#ff5fd2', 0.006, 0.26);

    // Chute.
    const chutePoints = projectCircle(CHUTE.x, CHUTE.z, CHUTE.r, FLOOR + 0.018, 32);
    poly(chutePoints, 'rgba(1, 3, 10, 0.98)', 'rgba(255, 95, 210, 0.5)', 1.3);
    const inner = projectCircle(CHUTE.x, CHUTE.z, CHUTE.r * 0.72, FLOOR + 0.024, 28);
    poly(inner, 'rgba(5, 8, 19, 0.88)', 'rgba(112, 243, 255, 0.2)', 1);
    const chuteCenter = projectPoint(CHUTE.x, FLOOR + 0.03, CHUTE.z);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const chuteGlow = ctx.createRadialGradient(chuteCenter.x, chuteCenter.y, 0, chuteCenter.x, chuteCenter.y, Math.max(12, 1.6 * chuteCenter.s));
    chuteGlow.addColorStop(0, 'rgba(255, 95, 210, 0.16)');
    chuteGlow.addColorStop(1, 'rgba(255, 95, 210, 0)');
    ctx.fillStyle = chuteGlow;
    ctx.fillRect(chuteCenter.x - 2 * chuteCenter.s, chuteCenter.y - 2 * chuteCenter.s, 4 * chuteCenter.s, 4 * chuteCenter.s);
    ctx.restore();

    // A slow scan line over the floor.
    const scanR = 4.7 + Math.sin(t * 0.6) * 0.15;
    ctx.save();
    ctx.globalAlpha = 0.16;
    const scan = projectCircle(0, 0, scanR, FLOOR + 0.016, 48);
    ctx.strokeStyle = 'rgba(112, 243, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 10]);
    pathPoints(scan);
    ctx.stroke();
    ctx.restore();
  }

  function drawFloorShadow(x, z, radius, alpha) {
    const p = projectPoint(x, FLOOR + 0.012, z);
    const circle = projectCircle(x, z, radius, FLOOR + 0.012, 28);
    ctx.save();
    pathPoints(circle);
    ctx.clip();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(4, radius * p.s * 1.15));
    g.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    g.addColorStop(0.68, `rgba(0, 0, 0, ${alpha * 0.55})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - radius * p.s * 1.4, p.y - radius * p.s * 1.4, radius * p.s * 2.8, radius * p.s * 2.8);
    ctx.restore();
  }

  function drawFloorRing(x, z, radius, color, width, dash) {
    const points = projectCircle(x, z, radius, FLOOR + 0.02, 36);
    const p = projectPoint(x, FLOOR + 0.02, z);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * p.s);
    if (dash) {
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -animTime * 12;
    }
    pathPoints(points);
    ctx.stroke();
    ctx.restore();
  }

  function drawAimGround(t) {
    if (game.state !== 'aim') return;
    const ad = game.aimData;
    const color = ad ? aimColor(ad.chance) : 'rgba(112, 243, 255, 0.5)';
    const clawFloor = projectPoint(game.claw.x, FLOOR + 0.02, game.claw.z);
    const clawTop = projectPoint(game.claw.x, game.claw.y, game.claw.z);

    // Vertical guide line from the claw to the floor.
    ctx.save();
    ctx.strokeStyle = 'rgba(112, 243, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(clawTop.x, clawTop.y + 7);
    ctx.lineTo(clawFloor.x, clawFloor.y);
    ctx.stroke();
    ctx.restore();

    drawFloorRing(game.claw.x, game.claw.z, 1.02, color, 0.032, [5, 8]);
    drawFloorRing(game.claw.x, game.claw.z, 0.5, color, 0.016, null);

    const p = clawFloor;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i += 1) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const inner = 1.16;
      const outer = 1.35;
      const x1 = p.x + Math.cos(a) * inner * p.s;
      const y1 = p.y + Math.sin(a) * inner * p.s * 0.62;
      const x2 = p.x + Math.cos(a) * outer * p.s;
      const y2 = p.y + Math.sin(a) * outer * p.s * 0.62;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    if (ad && ad.toy) {
      const pulse = 0.62 + 0.18 * Math.sin(t * 4.4);
      ctx.save();
      ctx.globalAlpha = pulse;
      drawFloorRing(ad.toy.x, ad.toy.z, 0.72, color, 0.035, [3, 5]);
      ctx.restore();
    }
  }

  function drawShadows(t) {
    for (const toy of floorToys()) {
      drawFloorShadow(toy.x, toy.z, 0.48 * toy.scale, 0.44);
    }

    const h = invLerp(CLAW_LOW, CLAW_REST, game.claw.y);
    const radius = 0.48 + h * 0.32;
    drawFloorShadow(game.claw.x, game.claw.z, radius, 0.34 - h * 0.12);

    // Soft halo around the targeted plush.
    if (game.state === 'aim' && game.aimData && game.aimData.toy) {
      const toy = game.aimData.toy;
      const p = projectPoint(toy.x, FLOOR + 0.02, toy.z);
      const color = aimColor(game.aimData.chance);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.08 * Math.sin(t * 4.2);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(14, 0.9 * p.s));
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      ctx.restore();
    }
  }

  function drawToys(t) {
    const list = floorToys()
      .map((toy) => {
        const bob = Math.sin(t * 1.65 + toy.phase) * 0.032;
        return {
          toy,
          p: projectPoint(toy.x, FLOOR + Math.max(0, bob), toy.z),
        };
      })
      .sort((a, b) => b.p.d - a.p.d);

    for (const { toy, p } of list) {
      const unit = p.s * toy.scale;
      const tilt = Math.sin(t * 1.2 + toy.tiltSeed) * 0.02;
      drawPlushAt(ctx, toy.type, p.x, p.y, unit, {
        tilt,
        mini: false,
      });
    }
  }

  function drawFallingPrizes(t) {
    for (const toy of game.falling) {
      const p = projectPoint(toy.x, toy.y, toy.z);
      const fade = toy.y < FLOOR ? clamp(1 - (FLOOR - toy.y) / 1.1, 0, 1) : 1;
      const unit = p.s * toy.scale * (0.7 + fade * 0.3);
      ctx.save();
      ctx.globalAlpha = fade;
      drawPlushAt(ctx, toy.type, p.x, p.y, unit, {
        rotate: toy.rot,
        air: true,
      });
      ctx.restore();
    }
  }

  function drawHangingToy(t) {
    if (!game.carrying) return;
    const toy = game.carrying;
    const p = projectPoint(toy.x, toy.y, toy.z);
    const unit = p.s * toy.scale;
    const sway = Math.sin(t * 3.1 + toy.phase) * 0.035 + game.claw.swing * 0.2;
    drawPlushAt(ctx, toy.type, p.x, p.y, unit, {
      rotate: toy.rot + sway,
      air: true,
    });
  }

  function drawGantry(t) {
    const railY = 13.34;
    for (const z of [-3.92, 3.92]) {
      drawLine3D({ x: -4.94, y: railY, z }, { x: 4.94, y: railY, z }, {
        color: 'rgba(4, 9, 20, 0.9)',
        width: 0.15,
      });
      drawLine3D({ x: -4.94, y: railY, z }, { x: 4.94, y: railY, z }, {
        color: '#487092',
        width: 0.075,
      });
      drawLine3D({ x: -4.94, y: railY + 0.055, z }, { x: 4.94, y: railY + 0.055, z }, {
        color: 'rgba(198, 248, 255, 0.45)',
        width: 0.018,
      });
    }

    // Crossbeam follows the claw on its X axis.
    drawLine3D({ x: game.claw.x, y: railY, z: -4.06 }, { x: game.claw.x, y: railY, z: 4.06 }, {
      color: 'rgba(3, 7, 17, 0.94)',
      width: 0.18,
    });
    drawLine3D({ x: game.claw.x, y: railY, z: -4.06 }, { x: game.claw.x, y: railY, z: 4.06 }, {
      color: '#355875',
      width: 0.09,
    });
    drawLine3D({ x: game.claw.x + 0.025, y: railY + 0.06, z: -4.06 }, { x: game.claw.x + 0.025, y: railY + 0.06, z: 4.06 }, {
      color: 'rgba(190, 246, 255, 0.38)',
      width: 0.016,
    });

    // Carriage block.
    const carriage = projectPoint(game.claw.x, railY, game.claw.z);
    const cu = carriage.s;
    ctx.save();
    ctx.translate(carriage.x, carriage.y);
    roundedRectPath(ctx, -0.31 * cu, -0.2 * cu, 0.62 * cu, 0.38 * cu, 0.08 * cu);
    ctx.fillStyle = '#172842';
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 230, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    cFill(ctx, 0.18 * cu, 0, 0.035 * cu, '#70f3ff');
    ctx.restore();

    // Cable.
    const top = projectPoint(game.claw.x, railY, game.claw.z);
    const bottom = projectPoint(game.claw.x, game.claw.y + 0.4, game.claw.z);
    const cableWidth = Math.max(1, 0.022 * ((top.s + bottom.s) / 2));
    ctx.save();
    ctx.strokeStyle = 'rgba(1, 5, 12, 0.85)';
    ctx.lineWidth = cableWidth + 1.5;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(194, 239, 255, 0.76)';
    ctx.lineWidth = cableWidth;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawClaw(t) {
    const p = projectPoint(game.claw.x, game.claw.y, game.claw.z);
    const u = p.s;
    const shake = game.claw.shake;
    const sx = Math.sin(t * 58) * 2.3 * shake;
    const sy = Math.cos(t * 47) * 1.4 * shake;

    ctx.save();
    ctx.translate(p.x + sx, p.y + sy);
    ctx.rotate(game.claw.swing + Math.sin(t * 1.5) * 0.008);

    const open = clamp(game.claw.open, 0, 1);
    const metal = ctx.createLinearGradient(0, -0.4 * u, 0, 1.1 * u);
    metal.addColorStop(0, '#e8fdff');
    metal.addColorStop(0.3, '#94b5ca');
    metal.addColorStop(0.62, '#4a6c8d');
    metal.addColorStop(1, '#e3fbff');
    const darkMetal = 'rgba(4, 12, 24, 0.9)';

    // Back prong (mostly hidden by the hub).
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = darkMetal;
    ctx.lineWidth = Math.max(2, 0.16 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -0.02 * u);
    ctx.bezierCurveTo(0.01 * u, 0.36 * u, 0.01 * u, 0.68 * u, 0.0, 0.96 * u);
    ctx.stroke();
    ctx.strokeStyle = '#6687a2';
    ctx.lineWidth = Math.max(1.2, 0.075 * u);
    ctx.stroke();
    ctx.restore();

    // Hub mount.
    ctx.fillStyle = '#0b1728';
    roundedRectPath(ctx, -0.26 * u, -0.52 * u, 0.52 * u, 0.28 * u, 0.07 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 238, 255, 0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Side prongs.
    for (const side of [-1, 1]) {
      const spread = (0.34 + open * 0.72) * side;
      const tipX = spread * u;
      const tipY = (0.92 + open * 0.04) * u;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(side * 0.09 * u, 0.02 * u);
      ctx.bezierCurveTo(side * 0.52 * u, 0.06 * u, spread * 1.22 * u, 0.49 * u, tipX, tipY);
      ctx.strokeStyle = darkMetal;
      ctx.lineWidth = Math.max(2.6, 0.155 * u);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(side * 0.09 * u, 0.02 * u);
      ctx.bezierCurveTo(side * 0.52 * u, 0.06 * u, spread * 1.22 * u, 0.49 * u, tipX, tipY);
      ctx.strokeStyle = metal;
      ctx.lineWidth = Math.max(1.5, 0.085 * u);
      ctx.stroke();

      // Curved hook at the tip.
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.quadraticCurveTo(tipX - side * 0.02 * u, tipY + 0.16 * u, tipX - side * 0.17 * u, tipY + 0.12 * u);
      ctx.strokeStyle = darkMetal;
      ctx.lineWidth = Math.max(2, 0.12 * u);
      ctx.stroke();
      ctx.strokeStyle = metal;
      ctx.lineWidth = Math.max(1, 0.055 * u);
      ctx.stroke();

      // Tiny highlight on each prong shoulder.
      ctx.beginPath();
      ctx.moveTo(side * 0.14 * u, 0.11 * u);
      ctx.quadraticCurveTo(side * 0.42 * u, 0.24 * u, side * 0.56 * u, 0.5 * u);
      ctx.strokeStyle = 'rgba(239, 255, 255, 0.62)';
      ctx.lineWidth = Math.max(0.8, 0.018 * u);
      ctx.stroke();
      ctx.restore();
    }

    // Central hub.
    const hub = ctx.createRadialGradient(-0.12 * u, -0.16 * u, 0.02 * u, 0, 0, 0.39 * u);
    hub.addColorStop(0, '#f4ffff');
    hub.addColorStop(0.22, '#b9dce8');
    hub.addColorStop(0.52, '#5d819f');
    hub.addColorStop(0.8, '#1b334e');
    hub.addColorStop(1, '#071526');
    cShape(ctx, 0, 0, 0.38 * u, hub, 'rgba(5, 13, 25, 0.9)', Math.max(1.5, 0.035 * u));
    cFill(ctx, 0, 0, 0.13 * u, 'rgba(8, 24, 39, 0.9)');
    cFill(ctx, 0, 0, 0.055 * u, '#70f3ff');

    // Hub bolts.
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + Math.PI / 6;
      cFill(ctx, Math.cos(a) * 0.25 * u, Math.sin(a) * 0.25 * u, Math.max(1, 0.026 * u), 'rgba(218, 250, 255, 0.7)');
    }

    // A holographic readiness ring while aiming.
    if (game.state === 'aim') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(112, 243, 255, 0.28)';
      ctx.lineWidth = Math.max(1, 0.012 * u);
      ctx.beginPath();
      ctx.arc(0, 0.1 * u, 0.6 * u, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawAimLabel(t) {
    if (game.state !== 'aim' || !game.aimData || !game.aimData.toy) return;
    const ad = game.aimData;
    const p = projectPoint(game.claw.x, FLOOR + 0.02, game.claw.z);
    const color = aimColor(ad.chance);
    const pct = Math.round(ad.chance * 100);
    const label = ad.chance > 0 ? `${PLUSH[ad.toy.type].name} · ${pct}%` : '太远了';
    const font = 11;
    ctx.save();
    ctx.font = `700 ${font}px ${UI_FONT}`;
    const width = ctx.measureText(label).width + 18;
    const height = 22;
    const x = clamp(p.x - width / 2, 8, W - width - 8);
    const y = p.y - Math.max(44, p.s * 2.35 + 10);
    roundedRectPath(ctx, x, y, width, height, 11);
    ctx.fillStyle = 'rgba(4, 9, 22, 0.84)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
    ctx.restore();
  }

  function drawTargetBrackets(t) {
    if (game.state !== 'aim' || !game.aimData || !game.aimData.toy) return;
    const toy = game.aimData.toy;
    const p = projectPoint(toy.x, FLOOR + toy.scale * 1.08, toy.z);
    const unit = p.s * toy.scale;
    const halfW = unit * 0.55;
    const halfH = unit * 0.82;
    const color = aimColor(game.aimData.chance);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45 + 0.12 * Math.sin(t * 4.2);
    ctx.lineWidth = 1.4;
    const corners = [
      [-1, -1, 1, 1],
      [1, -1, -1, 1],
      [-1, 1, 1, -1],
      [1, 1, -1, -1],
    ];
    for (const [sx, sy, dx, dy] of corners) {
      const x = p.x + sx * halfW;
      const y = p.y + sy * halfH;
      ctx.beginPath();
      ctx.moveTo(x + dx * halfW * 0.3, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * halfH * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGlass(hull, t) {
    const glassFaces = [
      {
        pts: [[CAGE.x0, FLOOR, CAGE.z1], [CAGE.x1, FLOOR, CAGE.z1], [CAGE.x1, CAGE.top, CAGE.z1], [CAGE.x0, CAGE.top, CAGE.z1]],
        normal: { x: 0, y: 0, z: 1 },
        center: { x: 0, y: 8.6, z: CAGE.z1 },
      },
      {
        pts: [[CAGE.x1, FLOOR, CAGE.z0], [CAGE.x1, FLOOR, CAGE.z1], [CAGE.x1, CAGE.top, CAGE.z1], [CAGE.x1, CAGE.top, CAGE.z0]],
        normal: { x: 1, y: 0, z: 0 },
        center: { x: CAGE.x1, y: 8.6, z: 0 },
      },
      {
        pts: [[CAGE.x0, FLOOR, CAGE.z1], [CAGE.x0, FLOOR, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z1]],
        normal: { x: -1, y: 0, z: 0 },
        center: { x: CAGE.x0, y: 8.6, z: 0 },
      },
      {
        pts: [[CAGE.x1, FLOOR, CAGE.z0], [CAGE.x0, FLOOR, CAGE.z0], [CAGE.x0, CAGE.top, CAGE.z0], [CAGE.x1, CAGE.top, CAGE.z0]],
        normal: { x: 0, y: 0, z: -1 },
        center: { x: 0, y: 8.6, z: CAGE.z0 },
      },
    ];

    for (const face of glassFaces) {
      const glassToEye = {
        x: CAM.eye.x - face.center.x,
        y: CAM.eye.y - face.center.y,
        z: CAM.eye.z - face.center.z,
      };
      const facing =
        dot3(face.normal, glassToEye) / (Math.hypot(glassToEye.x, glassToEye.y, glassToEye.z) || 1);
      if (facing <= 0.2) continue;

      const pts = face.pts.map((p) => projectPoint(p[0], p[1], p[2]));
      ctx.save();
      pathPoints(pts);
      ctx.clip();

      const minX = Math.min(...pts.map((p) => p.x));
      const maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const bw = maxX - minX;
      const bh = maxY - minY;

      const sheen = ctx.createLinearGradient(minX, minY, maxX, maxY);
      sheen.addColorStop(0, 'rgba(164, 244, 255, 0.045)');
      sheen.addColorStop(0.38, 'rgba(164, 244, 255, 0.012)');
      sheen.addColorStop(0.55, 'rgba(255, 255, 255, 0.055)');
      sheen.addColorStop(0.7, 'rgba(112, 243, 255, 0.014)');
      sheen.addColorStop(1, 'rgba(255, 95, 210, 0.026)');
      ctx.fillStyle = sheen;
      ctx.fillRect(minX, minY, bw, bh);

      const shift = (Math.sin(t * 0.22) * 0.5 + 0.5) * bw * 0.35;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const streak = ctx.createLinearGradient(minX + shift, minY, minX + shift + bw * 0.16, maxY);
      streak.addColorStop(0, 'rgba(255, 255, 255, 0)');
      streak.addColorStop(0.5, 'rgba(212, 252, 255, 0.075)');
      streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = streak;
      ctx.fillRect(minX + shift, minY, bw * 0.18, bh);
      ctx.restore();

      ctx.restore();
      ctx.strokeStyle = 'rgba(196, 248, 255, 0.22)';
      ctx.lineWidth = 1;
      pathPoints(pts);
      ctx.stroke();
    }

    // Glass edge glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(112, 243, 255, 0.08)';
    ctx.lineWidth = 5;
    pathPoints(hull);
    ctx.stroke();
    ctx.restore();

    // Top pane, very subtle.
    const top = [
      [CAGE.x0, CAGE.top, CAGE.z1],
      [CAGE.x1, CAGE.top, CAGE.z1],
      [CAGE.x1, CAGE.top, CAGE.z0],
      [CAGE.x0, CAGE.top, CAGE.z0],
    ].map((p) => projectPoint(p[0], p[1], p[2]));
    poly(top, 'rgba(120, 230, 255, 0.025)', 'rgba(160, 240, 255, 0.18)', 1);
  }

  function drawFrame() {
    const posts = [
      [CAGE.x0, CAGE.z0],
      [CAGE.x1, CAGE.z0],
      [CAGE.x0, CAGE.z1],
      [CAGE.x1, CAGE.z1],
    ];

    for (const [x, z] of posts) {
      drawLine3D({ x, y: FLOOR, z }, { x, y: CAGE.top, z }, {
        color: 'rgba(3, 8, 18, 0.94)',
        width: 0.23,
      });
      drawLine3D({ x, y: FLOOR, z }, { x, y: CAGE.top, z }, {
        color: '#3b5a7a',
        width: 0.13,
      });
      drawLine3D({ x: x + 0.018, y: FLOOR + 0.08, z }, { x: x + 0.018, y: CAGE.top - 0.08, z }, {
        color: 'rgba(200, 247, 255, 0.28)',
        width: 0.014,
      });
    }

    const edgePairs = [
      [[CAGE.x0, CAGE.z0], [CAGE.x1, CAGE.z0]],
      [[CAGE.x0, CAGE.z1], [CAGE.x1, CAGE.z1]],
      [[CAGE.x0, CAGE.z0], [CAGE.x0, CAGE.z1]],
      [[CAGE.x1, CAGE.z0], [CAGE.x1, CAGE.z1]],
    ];

    for (const y of [FLOOR, CAGE.top]) {
      for (const [a, b] of edgePairs) {
        drawLine3D({ x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, {
          color: 'rgba(3, 7, 16, 0.94)',
          width: 0.19,
        });
        drawLine3D({ x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, {
          color: '#29425e',
          width: 0.095,
        });
      }
    }

    // Neon accents on the front corners.
    const front = CAM.eye.z > CAGE.z1;
    if (front) {
      drawNeonLine({ x: CAGE.x0, y: FLOOR + 0.12, z: CAGE.z1 + 0.012 }, { x: CAGE.x0, y: CAGE.top - 0.12, z: CAGE.z1 + 0.012 }, '#70f3ff', 0.007, 0.54);
      drawNeonLine({ x: CAGE.x1, y: FLOOR + 0.12, z: CAGE.z1 + 0.012 }, { x: CAGE.x1, y: CAGE.top - 0.12, z: CAGE.z1 + 0.012 }, '#ff5fd2', 0.007, 0.44);
    }

    for (const [x, z] of posts) {
      for (const y of [FLOOR, CAGE.top]) {
        const p = projectPoint(x, y, z);
        const r = Math.max(2, 0.1 * p.s);
        cShape(ctx, p.x, p.y, r, '#1a2c46', 'rgba(165, 230, 255, 0.34)', 1);
        cFill(ctx, p.x, p.y, r * 0.42, 'rgba(112, 243, 255, 0.5)');
      }
    }

    // Bottom rim highlight.
    drawLine3D({ x: CAGE.x0, y: FLOOR + 0.04, z: CAGE.z1 + 0.02 }, { x: CAGE.x1, y: FLOOR + 0.04, z: CAGE.z1 + 0.02 }, {
      color: 'rgba(190, 248, 255, 0.28)',
      width: 0.018,
    });
  }

  function drawSignFace(face, t) {
    const vertical = face.name === 'front' || face.name === 'back' || face.name === 'left' || face.name === 'right';
    if (!vertical) return;
    const center = face.center || faceCenter(face);
    const facing = dot3(face.normal, {
      x: CAM.eye.x - center.x,
      y: CAM.eye.y - center.y,
      z: CAM.eye.z - center.z,
    });
    if (facing <= 0.04) return;
    const alpha = clamp(facing / 6.5, 0, 1);
    const p = projectPoint(center.x, center.y, center.z);
    const projected = face.pts.map((pt) => projectPoint(pt[0], pt[1], pt[2]));
    const topY = Math.min(...projected.map((q) => q.y));
    const bottomY = Math.max(...projected.map((q) => q.y));
    const left = projected.reduce((best, q) => (q.x < best.x ? q : best), projected[0]);
    const right = projected.reduce((best, q) => (q.x > best.x ? q : best), projected[0]);
    const screenW = Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
    const screenH = Math.max(1, bottomY - topY);
    const label = face.name === 'left' || face.name === 'right' ? 'CLAW' : 'CLAWVERSE';
    const fontSize = Math.min(screenH * 0.38, screenW / (label.length * 0.64), 64);
    if (fontSize < 5) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const starY = p.y - screenH * 0.27;
    drawSparkle(ctx, p.x, starY, Math.max(2, fontSize * 0.3), '#ffd166', t * 0.3);
    drawSparkle(ctx, p.x, starY, Math.max(1, fontSize * 0.14), '#fff7d6', 0);

    ctx.fillStyle = '#f3feff';
    ctx.shadowColor = face.name === 'back' ? '#ff5fd2' : '#70f3ff';
    ctx.shadowBlur = fontSize * 0.6;
    ctx.font = `800 ${fontSize}px ${DISPLAY_FONT}`;
    ctx.fillText(label, p.x, p.y + screenH * 0.12);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = face.name === 'back' ? '#ffb6ee' : '#b9fbff';
    ctx.font = `700 ${Math.max(4, fontSize * 0.11)}px ${DISPLAY_FONT}`;
    ctx.fillText('STAR  ·  CLAW  ·  WIN', p.x, p.y + screenH * 0.34);
    ctx.restore();
  }

  function drawSign(t) {
    drawBox3D(
      { x0: SIGN.x0, x1: SIGN.x1, y0: SIGN.y0, y1: SIGN.y1, z0: SIGN.z0, z1: SIGN.z1 },
      {
        front: '#0d1538',
        back: '#0b1230',
        left: '#0b1230',
        right: '#0d1538',
        top: '#1b2b5c',
        bottom: '#040815',
        default: '#0b1230',
      },
      { stroke: 'rgba(2, 5, 13, 0.75)' }
    );

    const faces = boxFaces({
      x0: SIGN.x0,
      x1: SIGN.x1,
      y0: SIGN.y0,
      y1: SIGN.y1,
      z0: SIGN.z0,
      z1: SIGN.z1,
    }).filter(faceVisible);

    for (const face of faces) {
      const projected = face.pts.map((p) => projectPoint(p[0], p[1], p[2]));
      const center = faceCenter(face);
      const cp = projectPoint(center.x, center.y, center.z);
      const inset = projected.map((p) => ({
        x: cp.x + (p.x - cp.x) * 0.9,
        y: cp.y + (p.y - cp.y) * 0.84,
      }));
      ctx.save();
      poly(inset, 'rgba(112, 243, 255, 0.025)', 'rgba(112, 243, 255, 0.19)', 1);
      ctx.restore();
      drawSignFace(face, t);

      // Bulbs along the top edge.
      if (face.name !== 'top' && face.name !== 'bottom') {
        const a = face.pts[3];
        const b = face.pts[2];
        const count = face.name === 'front' || face.name === 'back' ? 9 : 7;
        for (let i = 0; i < count; i += 1) {
          const f = count === 1 ? 0.5 : i / (count - 1);
          const wp = {
            x: lerp(a[0], b[0], f),
            y: SIGN.y1 - 0.11,
            z: lerp(a[2], b[2], f),
          };
          const p = projectPoint(wp.x, wp.y, wp.z);
          const on = 0.56 + 0.34 * Math.sin(t * 3 + i * 0.8 + (face.name === 'back' ? 1.3 : 0));
          ctx.save();
          ctx.globalAlpha = on;
          cFill(ctx, p.x, p.y, Math.max(1.5, 0.035 * p.s), i % 2 ? '#ffd166' : '#70f3ff');
          ctx.restore();
        }
      }

      // Bright face outline.
      ctx.save();
      ctx.strokeStyle = 'rgba(112, 243, 255, 0.22)';
      ctx.lineWidth = 1.2;
      pathPoints(projected);
      ctx.stroke();
      ctx.restore();
    }

    // Neon edge along the marquee's top line.
    drawNeonLine({ x: SIGN.x0, y: SIGN.y1, z: SIGN.z1 }, { x: SIGN.x1, y: SIGN.y1, z: SIGN.z1 }, '#70f3ff', 0.011, 0.65);
    drawNeonLine({ x: SIGN.x1, y: SIGN.y1, z: SIGN.z1 }, { x: SIGN.x1, y: SIGN.y1, z: SIGN.z0 }, '#ff5fd2', 0.011, 0.45);
  }

  function drawTray(t) {
    if (!game.trayToy) return;
    if (CAM.eye.z <= MACHINE.z1) return;
    const p = projectPoint(TRAY.x, 0.9, TRAY.z);
    const u = p.s * 0.45 * (1 + game.trayPulse * 0.18);
    const alpha = clamp(1 - Math.max(0, game.trayAge - 10) / 2.5, 0.4, 1);

    ctx.save();
    const glow = ctx.createRadialGradient(p.x, p.y - 0.4 * p.s, 0, p.x, p.y - 0.2 * p.s, Math.max(15, 0.75 * p.s));
    glow.addColorStop(0, 'rgba(255, 95, 210, 0.18)');
    glow.addColorStop(0.5, 'rgba(112, 243, 255, 0.06)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
    drawPlushAt(ctx, game.trayToy, p.x, p.y, u, { alpha });
    ctx.restore();
  }

  function drawMachine(t) {
    drawBase(t);

    const hull = getCageHull();
    ctx.save();
    pathPoints(hull);
    ctx.clip();

    // Interior tint / depth bed.
    const interior = ctx.createLinearGradient(0, 0, 0, H);
    interior.addColorStop(0, 'rgba(11, 25, 56, 0.42)');
    interior.addColorStop(0.6, 'rgba(5, 12, 30, 0.6)');
    interior.addColorStop(1, 'rgba(3, 7, 19, 0.8)');
    ctx.fillStyle = interior;
    ctx.fillRect(0, 0, W, H);

    drawFarWalls(t);
    drawInteriorFloor(t);
    drawAimGround(t);
    drawShadows(t);
    drawToys(t);
    drawFallingPrizes(t);
    drawGantry(t);
    drawHangingToy(t);
    drawClaw(t);
    drawTargetBrackets(t);
    drawAimLabel(t);

    ctx.restore();

    drawGlass(hull, t);
    drawFrame();
    drawSign(t);
    drawTray(t);
  }

  function drawScreenConfetti() {
    drawConfetti();
  }

  /* ---------------- Render loop ---------------- */

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(animTime);
    drawMachine(animTime);
    drawParticles();
    drawScreenConfetti();
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, window.innerWidth);
    H = Math.max(420, window.innerHeight);
    SAFE_TOP = safeProbe ? Math.max(0, Math.min(90, safeProbe.getBoundingClientRect().height || 0)) : 0;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    computeViewport();
    updateCamera(0, true);
  }

  let lastFrame = performance.now();
  function loop(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.045);
    lastFrame = now;
    animTime += dt;
    updateCamera(dt);
    updateGame(dt);
    updateFalling(dt);
    if (CONFETTI.length) updateConfetti(dt);
    render();
    window.requestAnimationFrame(loop);
  }

  /* ---------------- Boot ---------------- */

  window.addEventListener('resize', resize);
  resize();
  paintMiniCanvases();
  resetGame();
  updateCamera(0, true);
  setViewLabel(0, true);
  updateHUD(true);
  window.requestAnimationFrame(loop);
})();
