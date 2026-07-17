// playerUI.js
//
// Wires everything together: file loading, transport controls, room
// sync, touch gestures, subtitles, and chat. VideoController,
// SocketClient, attachGestureControls, and SubtitleController are all
// loaded globally from their own files before this one.

function formatTime(seconds) {
  if (!isFinite(seconds)) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function initPlayer() {
  const videoEl = document.getElementById('video');
  const controller = new VideoController(videoEl);
  const socketClient = new SocketClient();

  // --- DOM refs -----------------------------------------------------------

  const videoStage = document.getElementById('video-stage');
  const controlsOverlay = document.getElementById('controls-overlay');
  const emptyState = document.getElementById('empty-state');
  const filePicker = document.getElementById('file-picker');

  const playPauseBtn = document.getElementById('play-pause-btn');
  const rewindBtn = document.getElementById('rewind-btn');
  const forwardBtn = document.getElementById('forward-btn');
  const seekBar = document.getElementById('seek-bar');
  const currentTimeEl = document.getElementById('current-time');
  const durationEl = document.getElementById('duration');

  const brightnessOverlay = document.getElementById('brightness-overlay');
  const gestureIndicator = document.getElementById('gesture-indicator');
  const gestureIcon = document.getElementById('gesture-icon');
  const gestureValue = document.getElementById('gesture-value');
  const centerFlash = document.getElementById('center-flash');

  const statusDotMe = document.getElementById('status-dot-me');
  const roomCodeMini = document.getElementById('room-code-mini');
  const roomMembersList = document.getElementById('room-members-list');

  const roomDrawer = document.getElementById('room-drawer');
  const roomPanelBtn = document.getElementById('room-panel-btn');
  const roomCloseBtn = document.getElementById('room-close-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');

  const roomStatus = document.getElementById('room-status');
  const createRoomBtn = document.getElementById('create-room-btn');
  const joinCodeInput = document.getElementById('join-code-input');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const roomCodeText = document.getElementById('room-code-text');
  const copyCodeBtn = document.getElementById('copy-code-btn');

  const chatDrawer = document.getElementById('chat-drawer');
  const chatToggleBtn = document.getElementById('chat-toggle-btn');
  const chatCloseBtn = document.getElementById('chat-close-btn');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  const subtitleDrawer = document.getElementById('subtitle-drawer');
  const subtitlePanelBtn = document.getElementById('subtitle-panel-btn');
  const subtitleCloseBtn = document.getElementById('subtitle-close-btn');
  const subtitlePicker = document.getElementById('subtitle-picker');
  const subtitleOverlay = document.getElementById('subtitle-overlay');
  const subtitleEnabledToggle = document.getElementById('subtitle-enabled-toggle');
  const delayMinusBtn = document.getElementById('delay-minus-btn');
  const delayPlusBtn = document.getElementById('delay-plus-btn');
  const delayValueEl = document.getElementById('delay-value');
  const fontMinusBtn = document.getElementById('font-minus-btn');
  const fontPlusBtn = document.getElementById('font-plus-btn');
  const fontValueEl = document.getElementById('font-value');

  const logDrawer = document.getElementById('log-drawer');
  const logToggleBtn = document.getElementById('log-toggle-btn');
  const logEl = document.getElementById('event-log');

  const subtitles = new SubtitleController(videoEl, subtitleOverlay);

  let isScrubbing = false;
  let controlsHideTimer = null;

  // --- Temporary verification log -----------------------------------------

  function logEvent(label, detail = {}) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${label}${
      detail.currentTime != null ? ` @ ${formatTime(detail.currentTime)}` : ''
    }`;
    console.log(line, detail);

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = line;
    logEl.prepend(entry);

    while (logEl.childElementCount > 50) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  // --- Controls auto-hide ---------------------------------------------------

  function showControls() {
    controlsOverlay.classList.remove('hidden-controls');
    clearTimeout(controlsHideTimer);
    if (!videoEl.paused) {
      controlsHideTimer = setTimeout(hideControls, 3000);
    }
  }

  function hideControls() {
    controlsOverlay.classList.add('hidden-controls');
  }

  function toggleControls() {
    if (controlsOverlay.classList.contains('hidden-controls')) {
      showControls();
    } else {
      hideControls();
    }
  }

  function flashCenterIcon(symbol) {
    centerFlash.textContent = symbol;
    centerFlash.classList.add('show');
    setTimeout(() => centerFlash.classList.remove('show'), 350);
  }

  // --- Fullscreen / landscape ---------------------------------------------
  //
  // iOS Safari does not support locking screen orientation at all — this
  // is an Apple platform restriction, not something fixable in code. On
  // iPhone, fullscreen will still work, but landscape needs a physical
  // rotation. Android generally supports both.

  async function enterImmersiveMode() {
    try {
      if (videoStage.requestFullscreen) {
        await videoStage.requestFullscreen();
      } else if (videoStage.webkitRequestFullscreen) {
        await videoStage.webkitRequestFullscreen();
      }
    } catch (err) {
      logEvent('FULLSCREEN_FAILED', {});
    }

    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (err) {
      // Expected to fail on iOS and in some desktop browsers — not fatal.
      logEvent('ORIENTATION_LOCK_UNAVAILABLE', {});
    }
  }

  function exitImmersiveMode() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  }

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) exitImmersiveMode();
    else enterImmersiveMode();
  });

  // --- File loading -----------------------------------------------------

  filePicker.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    controller.loadFile(file);
  });

  controller.addEventListener('file-loaded', (e) => {
    emptyState.hidden = true;
    logEvent('FILE_LOADED', {});
    showControls();
    enterImmersiveMode();
  });

  videoEl.addEventListener('loadedmetadata', () => {
    seekBar.max = controller.duration;
    durationEl.textContent = formatTime(controller.duration);
  });

  videoEl.addEventListener('timeupdate', () => {
    if (isScrubbing) return;
    seekBar.value = controller.currentTime;
    currentTimeEl.textContent = formatTime(controller.currentTime);
  });

  // --- Transport controls -----------------------------------------------

  playPauseBtn.addEventListener('click', () => {
    if (videoEl.paused) controller.play(); else controller.pause();
  });
  rewindBtn.addEventListener('click', () => controller.seekBy(-10));
  forwardBtn.addEventListener('click', () => controller.seekBy(10));

  seekBar.addEventListener('input', () => {
    isScrubbing = true;
    currentTimeEl.textContent = formatTime(Number(seekBar.value));
  });
  seekBar.addEventListener('change', () => {
    controller.seekTo(Number(seekBar.value));
    isScrubbing = false;
  });

  videoEl.addEventListener('play', () => {
    playPauseBtn.textContent = '⏸';
    showControls();
  });
  videoEl.addEventListener('pause', () => {
    playPauseBtn.textContent = '▶';
    showControls();
    clearTimeout(controlsHideTimer);
  });

  controller.addEventListener('local-action', (e) => {
    logEvent(`LOCAL_ACTION: ${e.detail.type.toUpperCase()}`, e.detail);
    socketClient.sendAction(e.detail.type, e.detail.currentTime);
  });

  // --- Gesture controls (volume / brightness / seek / play-pause / toggle) --

  let currentBrightness = 0; // 0 = full brightness, up to 0.85 = darkest
  let gestureHideTimer = null;

  attachGestureControls(videoStage, {
    onGestureStart: (zone) => {
      gestureIcon.textContent = zone === 'volume' ? '🔊' : '☀️';
      gestureIndicator.hidden = false;
    },
    onVolumeChange: (fraction) => {
      videoEl.volume = Math.min(1, Math.max(0, videoEl.volume + fraction));
      gestureValue.textContent = `${Math.round(videoEl.volume * 100)}%`;
    },
    onBrightnessChange: (fraction) => {
      currentBrightness = Math.min(0.85, Math.max(0, currentBrightness - fraction));
      brightnessOverlay.style.opacity = currentBrightness;
      gestureValue.textContent = `${Math.round((1 - currentBrightness) * 100)}%`;
    },
    onGestureEnd: () => {
      clearTimeout(gestureHideTimer);
      gestureHideTimer = setTimeout(() => { gestureIndicator.hidden = true; }, 500);
    },
    onSeekBy: (seconds) => {
      if (!videoEl.src) return;
      controller.seekBy(seconds);
      flashCenterIcon(seconds > 0 ? '»' : '«');
    },
    onTogglePlay: () => {
      if (!videoEl.src) return;
      if (videoEl.paused) { controller.play(); flashCenterIcon('▶'); }
      else { controller.pause(); flashCenterIcon('⏸'); }
    },
    onToggleControls: () => {
      if (!videoEl.src) return;
      toggleControls();
    },
  });

  // --- Room panel ---------------------------------------------------------

  const ROOM_CAPACITY = 10;

  function setRoomStatus(text) {
    roomStatus.textContent = text;
  }

  function updateMemberCount(count) {
    roomCodeMini.textContent = roomCodeText.textContent
      ? `#${roomCodeText.textContent} · ${count}/${ROOM_CAPACITY}`
      : 'No room';
    roomMembersList.textContent = `${count} of ${ROOM_CAPACITY} watching`;
    statusDotMe.classList.toggle('connected', count > 0);
    statusDotMe.classList.toggle('waiting', count === 1);
  }

  function showRoomCode(code, memberCount) {
    roomCodeText.textContent = code;
    roomCodeDisplay.hidden = false;
    createRoomBtn.hidden = true;
    document.getElementById('join-row').hidden = true;
    updateMemberCount(memberCount);
  }

  function resyncToPlaybackState(playbackState) {
    if (!playbackState || !videoEl.src) return;
    const elapsedSeconds = (Date.now() - playbackState.updatedAt) / 1000;
    const estimatedTime = playbackState.type === 'play'
      ? playbackState.currentTime + Math.max(0, elapsedSeconds)
      : playbackState.currentTime;
    controller.applyRemote(playbackState.type, { currentTime: estimatedTime });
    logEvent('RESYNCED_TO_ROOM', { currentTime: estimatedTime });
  }

  createRoomBtn.addEventListener('click', () => {
    setRoomStatus('Creating room…');
    socketClient.createRoom()
      .then(({ code, memberCount }) => {
        showRoomCode(code, memberCount);
        setRoomStatus(`Room created. Share the code — up to ${ROOM_CAPACITY} people can join.`);
        logEvent('ROOM_CREATED', {});
      })
      .catch(() => setRoomStatus('Could not create room. Try again.'));
  });

  joinRoomBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    setRoomStatus('Joining room…');
    socketClient.joinRoom(code)
      .then(({ code: joinedCode, playbackState, memberCount }) => {
        showRoomCode(joinedCode, memberCount);
        setRoomStatus('Connected! Syncing with the room…');
        logEvent('ROOM_JOINED', {});
        resyncToPlaybackState(playbackState);
      })
      .catch((err) => {
        const reason = err?.reason === 'ROOM_FULL' ? 'That room is full.' : 'Room not found.';
        setRoomStatus(reason);
      });
  });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(roomCodeText.textContent);
    copyCodeBtn.textContent = 'Copied!';
    setTimeout(() => { copyCodeBtn.textContent = 'Copy'; }, 1500);
  });

  roomPanelBtn.addEventListener('click', () => roomDrawer.classList.add('open'));
  roomCloseBtn.addEventListener('click', () => roomDrawer.classList.remove('open'));

  socketClient.addEventListener('peer-joined', (e) => {
    setRoomStatus('Someone joined the room!');
    updateMemberCount(e.detail.memberCount);
    logEvent('PEER_JOINED', {});
  });

  socketClient.addEventListener('peer-disconnected', (e) => {
    setRoomStatus('Someone left the room.');
    updateMemberCount(e.detail.memberCount);
    logEvent('PEER_DISCONNECTED', {});
  });

  socketClient.addEventListener('remote-action', (e) => {
    const { type, currentTime, serverTimestamp } = e.detail;
    if (!videoEl.src) return;
    const latencySeconds = Math.max(0, (Date.now() - serverTimestamp) / 1000);
    const adjustedTime = type === 'play' ? currentTime + latencySeconds : currentTime;
    controller.applyRemote(type, { currentTime: adjustedTime });
    logEvent(`REMOTE_ACTION: ${type.toUpperCase()}`, { currentTime: adjustedTime });
  });

  // --- Drift correction -----------------------------------------------------

  const HEARTBEAT_INTERVAL_MS = 5000;
  const DRIFT_TOLERANCE_SECONDS = 0.75;

  setInterval(() => {
    if (!videoEl.src || videoEl.paused) return;
    socketClient.sendHeartbeat(controller.currentTime);
  }, HEARTBEAT_INTERVAL_MS);

  socketClient.addEventListener('remote-heartbeat', (e) => {
    const { currentTime, serverTimestamp } = e.detail;
    if (!videoEl.src || videoEl.paused || isScrubbing) return;
    const latencySeconds = Math.max(0, (Date.now() - serverTimestamp) / 1000);
    const partnerEstimatedTime = currentTime + latencySeconds;
    const drift = partnerEstimatedTime - controller.currentTime;
    if (Math.abs(drift) > DRIFT_TOLERANCE_SECONDS) {
      controller.applyRemote('seek', { currentTime: partnerEstimatedTime });
      logEvent('DRIFT_CORRECTED', { currentTime: partnerEstimatedTime });
    }
  });

  // --- Chat -----------------------------------------------------------------

  function appendChatMessage(text, mine) {
    const el = document.createElement('div');
    el.className = `chat-msg ${mine ? 'mine' : 'theirs'}`;
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socketClient.sendChatMessage(text);
    appendChatMessage(text, true);
    chatInput.value = '';
  }

  chatToggleBtn.addEventListener('click', () => chatDrawer.classList.add('open'));
  chatCloseBtn.addEventListener('click', () => chatDrawer.classList.remove('open'));
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  socketClient.addEventListener('remote-chat-message', (e) => {
    appendChatMessage(e.detail.text, false);
  });

  // --- Subtitles --------------------------------------------------------

  subtitlePanelBtn.addEventListener('click', () => subtitleDrawer.classList.add('open'));
  subtitleCloseBtn.addEventListener('click', () => subtitleDrawer.classList.remove('open'));

  subtitlePicker.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await subtitles.loadFile(file);
    logEvent('SUBTITLE_LOADED', {});
  });

  subtitleEnabledToggle.addEventListener('change', () => {
    subtitles.toggle(subtitleEnabledToggle.checked);
  });

  delayMinusBtn.addEventListener('click', () => {
    subtitles.adjustDelay(-100);
    delayValueEl.textContent = `${subtitles.delayMs}ms`;
  });
  delayPlusBtn.addEventListener('click', () => {
    subtitles.adjustDelay(100);
    delayValueEl.textContent = `${subtitles.delayMs}ms`;
  });

  fontMinusBtn.addEventListener('click', () => {
    subtitles.setFontSize(subtitles.fontSizePx - 2);
    fontValueEl.textContent = `${subtitles.fontSizePx}px`;
  });
  fontPlusBtn.addEventListener('click', () => {
    subtitles.setFontSize(subtitles.fontSizePx + 2);
    fontValueEl.textContent = `${subtitles.fontSizePx}px`;
  });

  // --- Debug log drawer ---------------------------------------------------

  logToggleBtn.addEventListener('click', () => logDrawer.classList.toggle('open'));
}

document.addEventListener('DOMContentLoaded', initPlayer);
