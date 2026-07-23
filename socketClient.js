// socketClient.js
//
// Thin wrapper around the Socket.io client. Nothing in here touches the
// <video> element directly — it just talks to the server and dispatches
// DOM events that playerUI.js listens to. Keeping this separate means
// the video logic (videoController.js) never needs to know networking
// exists.
//
// Loaded as a plain global script — depends on the Socket.io client
// library being loaded first (see the CDN <script> tag in index.html).

const SERVER_URL = 'https://freeman3347.bonto.run';

class SocketClient extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.roomCode = null;
  }

  /** Open the connection. Safe to call more than once. */
  connect() {
    if (this.socket) return;

    this.socket = io(SERVER_URL);

    this.socket.on('connect', () => {
      this.dispatchEvent(new CustomEvent('connected'));
    });

    this.socket.on('disconnect', () => {
      this.dispatchEvent(new CustomEvent('disconnected'));
    });

    this.socket.on('peer-joined', (payload) => {
      this.dispatchEvent(new CustomEvent('peer-joined', { detail: payload }));
    });

    this.socket.on('peer-disconnected', (payload) => {
      this.dispatchEvent(new CustomEvent('peer-disconnected', { detail: payload }));
    });

    // The server relays these three event types verbatim, each carrying
    // a serverTimestamp we use for latency compensation.
    ['play', 'pause', 'seek'].forEach((type) => {
      this.socket.on(type, (payload) => {
        this.dispatchEvent(new CustomEvent('remote-action', {
          detail: { type, ...payload },
        }));
      });
    });

    // Periodic drift-correction pings — see playerUI.js for how these
    // are used to nudge playback back in sync without a full seek.
    this.socket.on('heartbeat', (payload) => {
      this.dispatchEvent(new CustomEvent('remote-heartbeat', { detail: payload }));
    });

    this.socket.on('chat-message', (payload) => {
      this.dispatchEvent(new CustomEvent('remote-chat-message', { detail: payload }));
    });
  }

  /** Create a new room. Resolves with { code, roster }. */
  createRoom(nickname) {
    this.connect();
    return new Promise((resolve, reject) => {
      this.socket.emit('create-room', { nickname }, (response) => {
        if (response?.ok) {
          this.roomCode = response.code;
          resolve(response);
        } else {
          reject(response);
        }
      });
    });
  }

  /** Join an existing room by code. Resolves with { code, playbackState, roster }. */
  joinRoom(code, nickname) {
    this.connect();
    return new Promise((resolve, reject) => {
      this.socket.emit('join-room', { code, nickname }, (response) => {
        if (response?.ok) {
          this.roomCode = response.code;
          resolve(response);
        } else {
          reject(response);
        }
      });
    });
  }

  /** Send a local play/pause/seek action out to the partner. */
  sendAction(type, currentTime) {
    if (!this.socket || !this.roomCode) return; // not in a room yet
    this.socket.emit(type, { currentTime });
  }

  /** Send a periodic "here's roughly where I am" ping for drift correction. */
  sendHeartbeat(currentTime) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('heartbeat', { currentTime });
  }

  sendChatMessage(text) {
    if (!this.socket || !this.roomCode) return;
    this.socket.emit('chat-message', { text });
  }
}
