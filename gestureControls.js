// gestureControls.js
//
// MX-Player-style touch gestures over the video surface:
//   - Swipe up/down on the RIGHT half  -> volume
//   - Swipe up/down on the LEFT half   -> brightness (simulated with a
//     dark overlay, since browsers don't expose real screen brightness)
//   - Single tap                       -> toggle the control bar
//   - Double tap LEFT third            -> seek back 10s
//   - Double tap RIGHT third           -> seek forward 10s
//   - Double tap CENTER third          -> play/pause
//
// This only handles gesture *detection* — it calls the callbacks you
// give it and never touches the video element directly, so it stays
// reusable and easy to reason about independently of playback logic.

function attachGestureControls(surfaceEl, callbacks) {
  const {
    onVolumeChange,     // (delta: -1..1 fraction of full swipe) => void
    onBrightnessChange, // (delta: -1..1 fraction of full swipe) => void
    onSeekBy,           // (seconds: number) => void
    onTogglePlay,       // () => void
    onToggleControls,   // () => void
    onGestureStart,     // (type: 'volume' | 'brightness') => void
    onGestureEnd,       // () => void
  } = callbacks;

  const DOUBLE_TAP_WINDOW_MS = 280;
  const DRAG_THRESHOLD_PX = 6; // ignore tiny jitter before treating as a drag

  let touchStartY = null;
  let touchStartX = null;
  let activeZone = null; // 'volume' | 'brightness' | null
  let isDragging = false;
  let lastTapTime = 0;
  let lastTapX = null;

  function zoneForX(x) {
    const rect = surfaceEl.getBoundingClientRect();
    return (x - rect.left) < rect.width / 2 ? 'brightness' : 'volume';
  }

  function thirdForX(x) {
    const rect = surfaceEl.getBoundingClientRect();
    const relative = (x - rect.left) / rect.width;
    if (relative < 1 / 3) return 'left';
    if (relative > 2 / 3) return 'right';
    return 'center';
  }

  surfaceEl.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    touchStartY = touch.clientY;
    touchStartX = touch.clientX;
    activeZone = zoneForX(touch.clientX);
    isDragging = false;
  }, { passive: true });

  surfaceEl.addEventListener('touchmove', (e) => {
    if (touchStartY === null) return;
    const touch = e.touches[0];
    const deltaY = touchStartY - touch.clientY;

    if (!isDragging && Math.abs(deltaY) > DRAG_THRESHOLD_PX) {
      isDragging = true;
      onGestureStart?.(activeZone);
    }
    if (!isDragging) return;

    const rect = surfaceEl.getBoundingClientRect();
    const fraction = deltaY / rect.height; // full-height drag = 100%

    if (activeZone === 'volume') {
      onVolumeChange?.(fraction);
    } else {
      onBrightnessChange?.(fraction);
    }
    // Reset the baseline so movement is relative, not cumulative from start.
    touchStartY = touch.clientY;
  }, { passive: true });

  surfaceEl.addEventListener('touchend', (e) => {
    if (isDragging) {
      onGestureEnd?.();
      touchStartY = null;
      touchStartX = null;
      activeZone = null;
      isDragging = false;
      return;
    }

    // Not a drag — treat as a tap. Check for double-tap first.
    const now = Date.now();
    const tapX = touchStartX;
    const isDoubleTap = (now - lastTapTime) < DOUBLE_TAP_WINDOW_MS
      && lastTapX !== null
      && Math.abs(tapX - lastTapX) < 60;

    if (isDoubleTap) {
      const third = thirdForX(tapX);
      if (third === 'left') onSeekBy?.(-10);
      else if (third === 'right') onSeekBy?.(10);
      else onTogglePlay?.();
      lastTapTime = 0; // consume, don't chain into a triple-tap
    } else {
      lastTapTime = now;
      lastTapX = tapX;
      // Delay the single-tap action slightly so a following second tap
      // can still be recognized as a double-tap instead.
      setTimeout(() => {
        if (Date.now() - lastTapTime >= DOUBLE_TAP_WINDOW_MS) {
          onToggleControls?.();
        }
      }, DOUBLE_TAP_WINDOW_MS + 10);
    }

    touchStartY = null;
    touchStartX = null;
    activeZone = null;
  });
}
