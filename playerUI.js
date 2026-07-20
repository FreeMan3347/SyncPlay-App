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
  const voiceCall = new VoiceCall(socketClient);

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
  const embeddedSubtitleRow = document.getElementById('embedded-subtitle-row');
  const embeddedSubtitleSelect = document.getElementById('embedded-subtitle-select');
  const audioTrackRow = document.getElementById('audio-track-row');
  const audioTrackSelect = document.getElementById('audio-track-select');
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
    subtitleOverlay.classList.add('controls-visible');
    clearTimeout(controlsHideTimer);
    controlsHideTimer = setTimeout(hideControls, 3000);
  }

  function hideControls() {
    controlsOverlay.classList.add('hidden-controls');
    subtitleOverlay.classList.remove('controls-visible');
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
    detectEmbeddedTracks();
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

  // --- Desktop (mouse) equivalent of the touch gestures above ---------------
  //
  // attachGestureControls only listens for touchstart/touchmove/touchend,
  // which a mouse never fires. Without this, controls auto-hide after 3s
  // on desktop and nothing brings them back. Attached directly to the
  // <video> element (not the whole stage) so clicks on buttons — which
  // live elsewhere in the layout, not inside the video element itself —
  // never bubble into this and cause double-triggering.

  videoEl.addEventListener('click', () => {
    if (!videoEl.src) return;
    toggleControls();
  });

  videoStage.addEventListener('mousemove', () => {
    if (!videoEl.src) return;
    showControls();
  });

  // --- Room panel ---------------------------------------------------------

  const ROOM_CAPACITY = 10;
  const nicknameInput = document.getElementById('nickname-input');
  let myNickname = 'Guest';
  let myNicknames = {}; // socketId -> nickname, built from roster broadcasts
  voiceCall.setRoomRosterProvider(() => Object.keys(myNicknames));

  function currentNickname() {
    return nicknameInput.value.trim().slice(0, 24) || 'Guest';
  }

  function setRoomStatus(text) {
    roomStatus.textContent = text;
  }

  function updateRoster(roster) {
    myNicknames = {};
    roster.forEach((m) => { myNicknames[m.socketId] = m.nickname; });

    const count = roster.length;
    roomCodeMini.textContent = roomCodeText.textContent
      ? `#${roomCodeText.textContent} · ${count}/${ROOM_CAPACITY}`
      : 'No room';
    roomMembersList.textContent = roster.map((m) => m.nickname).join(', ');
    statusDotMe.classList.toggle('connected', count > 0);
    statusDotMe.classList.toggle('waiting', count === 1);
  }

  function showRoomCode(code, roster) {
    roomCodeText.textContent = code;
    roomCodeDisplay.hidden = false;
    createRoomBtn.hidden = true;
    document.getElementById('join-row').hidden = true;
    nicknameInput.disabled = true;
    updateRoster(roster);
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
    myNickname = currentNickname();
    setRoomStatus('Creating room…');
    socketClient.createRoom(myNickname)
      .then(({ code, roster }) => {
        showRoomCode(code, roster);
        setRoomStatus(`Room created. Share the code — up to ${ROOM_CAPACITY} people can join.`);
        logEvent('ROOM_CREATED', {});
      })
      .catch(() => setRoomStatus('Could not create room. Try again.'));
  });

  joinRoomBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    myNickname = currentNickname();
    setRoomStatus('Joining room…');
    socketClient.joinRoom(code, myNickname)
      .then(({ code: joinedCode, playbackState, roster }) => {
        showRoomCode(joinedCode, roster);
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
    setRoomStatus(`${e.detail.nickname} joined the room!`);
    updateRoster(e.detail.roster);
    logEvent('PEER_JOINED', {});
    // If I'm currently talking, this new person needs a connection to
    // hear me — I wasn't connected to them yet since they just arrived.
    voiceCall.connectToNewRoomMember(e.detail.socketId);
  });

  socketClient.addEventListener('peer-disconnected', (e) => {
    setRoomStatus(`${e.detail.nickname} left the room.`);
    updateRoster(e.detail.roster);
    logEvent('PEER_DISCONNECTED', {});
    voiceCall.disconnectPeer(e.detail.socketId);
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

  function appendChatMessage(text, mine, nickname) {
    const el = document.createElement('div');
    el.className = `chat-msg ${mine ? 'mine' : 'theirs'}`;

    const nameEl = document.createElement('div');
    nameEl.className = 'chat-msg-name';
    nameEl.textContent = mine ? 'You' : nickname;
    el.appendChild(nameEl);

    const textEl = document.createElement('div');
    textEl.textContent = text;
    el.appendChild(textEl);

    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    socketClient.sendChatMessage(text);
    appendChatMessage(text, true, myNickname);
    chatInput.value = '';
  }

  chatToggleBtn.addEventListener('click', () => chatDrawer.classList.add('open'));
  chatCloseBtn.addEventListener('click', () => chatDrawer.classList.remove('open'));
  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  socketClient.addEventListener('remote-chat-message', (e) => {
    appendChatMessage(e.detail.text, false, e.detail.nickname || 'Guest');
  });

  // --- Embedded tracks (native browser-exposed only) -----------------------
  //
  // Browsers only expose embedded subtitle/audio tracks for containers
  // and codecs they natively demux — this works for some MP4 files with
  // in-band WebVTT/tx3g tracks, and audioTracks support varies by
  // browser (solid in Chrome/Edge, limited elsewhere). It will NOT find
  // subtitle/audio tracks muxed inside formats the browser doesn't
  // decode internally (e.g. most MKV multi-track files) — genuinely
  // extracting those would need a client-side demuxer library, which is
  // a much bigger addition than a dropdown.

  function detectEmbeddedTracks() {
    // Subtitle/caption tracks
    embeddedSubtitleSelect.innerHTML = '';
    const textTracks = [...videoEl.textTracks].filter(
      (t) => t.kind === 'subtitles' || t.kind === 'captions'
    );

    if (textTracks.length > 0) {
      embeddedSubtitleRow.hidden = false;
      const offOption = new Option('Off (use loaded file)', '-1');
      embeddedSubtitleSelect.appendChild(offOption);
      textTracks.forEach((track, i) => {
        embeddedSubtitleSelect.appendChild(
          new Option(track.label || track.language || `Track ${i + 1}`, String(i))
        );
        track.mode = 'disabled';
      });
    } else {
      embeddedSubtitleRow.hidden = true;
    }

    // Audio tracks (Chrome/Edge support this well; other browsers vary)
    audioTrackSelect.innerHTML = '';
    if (videoEl.audioTracks && videoEl.audioTracks.length > 1) {
      audioTrackRow.hidden = false;
      [...videoEl.audioTracks].forEach((track, i) => {
        audioTrackSelect.appendChild(
          new Option(track.label || track.language || `Audio ${i + 1}`, String(i))
        );
      });
    } else {
      audioTrackRow.hidden = true;
    }
  }

  embeddedSubtitleSelect.addEventListener('change', () => {
    const chosen = Number(embeddedSubtitleSelect.value);
    [...videoEl.textTracks].forEach((track, i) => {
      track.mode = i === chosen ? 'showing' : 'disabled';
    });
    // An embedded track and our own custom-rendered overlay would
    // otherwise show two sets of subtitles at once — turn ours off
    // when a native track is selected.
    if (chosen >= 0) {
      subtitles.toggle(false);
      subtitleEnabledToggle.checked = false;
    }
  });

  audioTrackSelect.addEventListener('change', () => {
    const chosen = Number(audioTrackSelect.value);
    [...videoEl.audioTracks].forEach((track, i) => {
      track.enabled = i === chosen;
    });
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

  // --- Keyboard controls ---------------------------------------------------
  //
  // Ignored when focus is inside a text input (chat, join code, etc.) so
  // typing a message doesn't accidentally seek or toggle playback.

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!videoEl.src) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (videoEl.paused) controller.play(); else controller.pause();
        showControls();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        controller.seekBy(-10);
        flashCenterIcon('«');
        showControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        controller.seekBy(10);
        flashCenterIcon('»');
        showControls();
        break;
      case 'ArrowUp':
        e.preventDefault();
        videoEl.volume = Math.min(1, videoEl.volume + 0.1);
        showControls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        videoEl.volume = Math.max(0, videoEl.volume - 0.1);
        showControls();
        break;
    }
  });

  // --- Voice call -----------------------------------------------------------
  //
  // Broadcast model: everyone in the room always listens automatically
  // (no button needed for that) — this button only controls whether
  // YOU are one of the up to 4 people currently talking.

  const voiceToggleBtn = document.getElementById('voice-toggle-btn');
  const voiceBuzzBtn = document.getElementById('voice-buzz-btn');
  const voiceStatus = document.getElementById('voice-status');
  const VOICE_CAPACITY = 4;

  voiceToggleBtn.addEventListener('click', async () => {
    if (voiceCall.isTalking) {
      voiceCall.stopTalking();
      voiceToggleBtn.classList.remove('active');
      logEvent('VOICE_STOPPED_TALKING', {});
      return;
    }

    voiceToggleBtn.disabled = true;
    const result = await voiceCall.startTalking();
    voiceToggleBtn.disabled = false;

    if (result.ok) {
      voiceToggleBtn.classList.add('active');
      logEvent('VOICE_STARTED_TALKING', {});
    } else if (result.reason === 'MIC_DENIED') {
      setRoomStatus('Microphone access was blocked — check your browser permissions.');
    } else if (result.reason === 'VOICE_FULL') {
      setRoomStatus(`Talking is full (${VOICE_CAPACITY}/${VOICE_CAPACITY}). Use 🔔 to ask for a turn.`);
    } else if (result.reason === 'NO_ROOM') {
      setRoomStatus('Join a room before talking.');
    }
  });

  voiceBuzzBtn.addEventListener('click', () => {
    voiceCall.buzz();
    logEvent('VOICE_BUZZED', {});
  });

  voiceCall.addEventListener('roster-changed', (e) => {
    const roster = e.detail;
    const count = roster.length;
    voiceStatus.textContent = count > 0 ? `🎙️ ${count}/${VOICE_CAPACITY} talking` : '';
    voiceBuzzBtn.hidden = !(count >= VOICE_CAPACITY && !voiceCall.isTalking);
  });

  voiceCall.addEventListener('buzzed', (e) => {
    setRoomStatus(`🔔 ${e.detail.nickname} wants to join the voice call.`);
    logEvent('VOICE_BUZZ_RECEIVED', {});
  });

  // --- Debug log drawer ---------------------------------------------------

  logToggleBtn.addEventListener('click', () => logDrawer.classList.toggle('open'));

  showControls(); // sync initial state (subtitle position, hide timer)
}

document.addEventListener('DOMContentLoaded', initPlayer);
