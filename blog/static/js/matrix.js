(() => {
  const canvas = document.getElementById('matrix-canvas');
  if (!canvas) {
    return;
  }

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    return;
  }

  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const charSet = 'アカサタナハマヤラワ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+-<>?';
  const sessionStorageKey = 'matrix:state:v1';

  const config = {
    fontSize: 18,
    stepX: 22,
    fadeFill: 'rgba(8, 15, 10, 0.12)',
    glyphColor: '#00ff9f',
    frameMs: 50,
  };

  let width = 0;
  let height = 0;
  let columns = 0;
  let yPositions = [];
  let resetOffsets = [];
  let animationId = 0;
  let lastFrameTime = 0;
  let frameParity = 0;

  const randomGlyph = () => charSet[Math.floor(Math.random() * charSet.length)];

  const readStoredState = () => {
    try {
      const rawState = window.sessionStorage.getItem(sessionStorageKey);
      if (!rawState) {
        return null;
      }

      const parsedState = JSON.parse(rawState);
      if (!parsedState || !Array.isArray(parsedState.yPositions)) {
        return null;
      }

      return parsedState;
    } catch {
      return null;
    }
  };

  const saveState = () => {
    try {
      if (!yPositions.length) {
        return;
      }

      window.sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          stepX: config.stepX,
          yPositions,
        }),
      );
    } catch {
      // Ignore storage access issues (private mode, quota, disabled storage)
    }
  };

  const initializeColumns = (storedState) => {
    columns = Math.floor(width / config.stepX) + 1;
    resetOffsets = Array.from({ length: columns }, () => 140 + Math.random() * 1400);
    const canRestoreState =
      storedState &&
      storedState.stepX === config.stepX &&
      storedState.yPositions.length === columns &&
      storedState.yPositions.every((position) => Number.isFinite(position));

    if (canRestoreState) {
      yPositions = [...storedState.yPositions];
      return;
    }

    yPositions = Array.from({ length: columns }, () => Math.random() * -height);
  };

  const resizeCanvas = (storedState = null) => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#050805';
    context.fillRect(0, 0, width, height);
    context.font = `${config.fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    initializeColumns(storedState);
  };

  const drawFrame = (timestamp) => {
    if (timestamp - lastFrameTime < config.frameMs) {
      animationId = window.requestAnimationFrame(drawFrame);
      return;
    }

    lastFrameTime = timestamp;
    context.fillStyle = config.fadeFill;
    context.fillRect(0, 0, width, height);

    context.fillStyle = config.glyphColor;
    frameParity = (frameParity + 1) % 2;

    for (let index = frameParity; index < yPositions.length; index += 2) {
      const x = index * config.stepX;
      const y = yPositions[index];
      context.fillText(randomGlyph(), x, y);

      if (y > height + resetOffsets[index]) {
        yPositions[index] = Math.random() * -280;
        resetOffsets[index] = 140 + Math.random() * 1400;
      } else {
        yPositions[index] = y + config.fontSize;
      }
    }

    animationId = window.requestAnimationFrame(drawFrame);
  };

  const stopAnimation = () => {
    if (animationId) {
      window.cancelAnimationFrame(animationId);
      animationId = 0;
    }
  };

  const startAnimation = () => {
    if (mediaQuery.matches) {
      stopAnimation();
      context.fillStyle = '#050805';
      context.fillRect(0, 0, width, height);
      return;
    }

    if (!animationId) {
      lastFrameTime = 0;
      animationId = window.requestAnimationFrame(drawFrame);
    }
  };

  resizeCanvas(readStoredState());
  startAnimation();

  window.addEventListener('resize', resizeCanvas, { passive: true });
  window.addEventListener('pagehide', saveState);
  document.addEventListener('click', saveState, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveState();
      stopAnimation();
      return;
    }

    startAnimation();
  });

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', startAnimation);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(startAnimation);
  }
})();
