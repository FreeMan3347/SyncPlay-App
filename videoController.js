// videoController.js
//
// Wraps the native <video> element and exposes a clean API for loading a
// local file and driving playback. This module knows nothing about
// networking — it just plays video and reports what happened.
//
// IMPORTANT — the "ignore next event" mechanism:
// Later, when a partner's play/pause/seek arrives over the socket, we'll
// call applyRemote() to mirror it locally. Doing so causes the native
// <video> element to fire its own 'play' / 'pause' / 'seeked' events,
// which would normally be picked up as a fresh LOCAL action and
// re-broadcast to the server — creating an infinite echo loop between
// two clients. To prevent that, applyRemote() sets a short suppression
// window; any native events that fire inside that window are treated as
// side effects of a remote command, not genuine user input, and are
// swallowed instead of re-emitted.

const SUPPRESSION_WINDOW_MS = 250;

class VideoController extends EventTarget {
  constructor(videoElement) {
    super();
    this.video = videoElement;
    this.currentFileName = null;

    // Timestamp until which native events should be ignored.
    // null / in the past = not suppressing.
    this._suppressUntil = null;

    this._bindNativeEvents();
  }

  _bindNativeEvents() {
    this.video.addEventListener('play', () => this._emitLocal('play'));
    this.video.addEventListener('pause', () => this._emitLocal('pause'));
    this.video.addEventListener('seeked', () => this._emitLocal('seek'));
  }

  _isSuppressed() {
    return this._suppressUntil !== null && Date.now() < this._suppressUntil;
  }

  _emitLocal(type) {
    if (this._isSuppressed()) {
      // This event was caused by applyRemote(), not the user. Ignore it.
      return;
    }
    this.dispatchEvent(new CustomEvent('local-action', {
      detail: {
        type,                              // 'play' | 'pause' | 'seek'
        currentTime: this.video.currentTime,
        timestamp: Date.now(),
      },
    }));
  }

  /** Load a local File object (from <input type="file">) into the player. */
  loadFile(file) {
    const url = URL.createObjectURL(file);
    this.video.src = url;
    this.currentFileName = file.name;
    this.dispatchEvent(new CustomEvent('file-loaded', {
      detail: { name: file.name },
    }));
  }

  // --- Local user-driven controls -----------------------------------

  play() { this.video.play(); }
  pause() { this.video.pause(); }
  seekTo(time) { this.video.currentTime = Math.max(0, time); }
  seekBy(deltaSeconds) {
    this.video.currentTime = Math.max(0, this.video.currentTime + deltaSeconds);
  }

  // --- Remote-driven controls (foundation for Part 3: socket sync) ---

  /**
   * Apply a command that came from the partner over the network, without
   * re-broadcasting it as if it were a new local action.
   * type: 'play' | 'pause' | 'seek'
   * payload: { currentTime?: number }
   */
  applyRemote(type, payload = {}) {
    this._suppressUntil = Date.now() + SUPPRESSION_WINDOW_MS;

    switch (type) {
      case 'play':
        if (payload.currentTime != null) this.video.currentTime = payload.currentTime;
        this.video.play();
        break;
      case 'pause':
        if (payload.currentTime != null) this.video.currentTime = payload.currentTime;
        this.video.pause();
        break;
      case 'seek':
        this.video.currentTime = payload.currentTime;
        break;
      default:
        this._suppressUntil = null;
    }
  }

  get duration() { return this.video.duration || 0; }
  get currentTime() { return this.video.currentTime || 0; }
}
