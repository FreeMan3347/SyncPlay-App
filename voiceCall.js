// voiceCall.js
//
// Broadcast-style voice, not a closed call: EVERYONE in the room (up to
// 10) always listens; up to 4 people can talk simultaneously (see
// rooms.js / socketHandlers.js — capacity-limited because this is mesh
// WebRTC with no media relay server, and a talker sending audio to 9
// other people is already close to the practical ceiling for that).
//
// Key design point that took a rewrite to get right: when someone stops
// talking, we do NOT close their peer connections. If we did, every
// unrelated change to the talker roster (someone else starting/stopping)
// would risk tearing down connections that had nothing to do with that
// change. Instead, "stop talking" just disables the local audio track —
// the connection stays alive, silent, ready to resume instantly. The
// only time a connection actually closes is when someone leaves the
// room entirely.
//
// Honest limitation: no TURN server (paid, not in budget), only public
// STUN. Most networks connect fine; some VPN/restrictive-NAT
// combinations may fail to connect to one specific person with no code
// fix available short of paying for TURN.

const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

class VoiceCall extends EventTarget {
  constructor(socketClient) {
    super();
    this.socketClient = socketClient;
    this.localStream = null;
    this.peers = new Map(); // socketId -> RTCPeerConnection (persists once made)
    this.audioEls = new Map(); // socketId -> <audio> element playing their stream
    this.isTalking = false;
    this._signalingBound = false;
    this._roomRosterIds = () => []; // set by playerUI.js — who's currently in the room

    this.socketClient.addEventListener('connected', () => this._bindSignaling());
  }

  /** playerUI.js calls this with a function returning current room member socket ids. */
  setRoomRosterProvider(fn) {
    this._roomRosterIds = fn;
  }

  _bindSignaling() {
    if (this._signalingBound) return;
    this._signalingBound = true;
    const socket = this.socketClient.socket;

    // Informational only now — used for the UI count and to decide
    // whether the buzzer should show, not for connection teardown.
    socket.on('voice-roster', (roster) => {
      this.dispatchEvent(new CustomEvent('roster-changed', { detail: roster }));
    });

    socket.on('voice-signal', async ({ from, data }) => {
      await this._handleSignal(from, data);
    });

    socket.on('voice-buzz', (payload) => {
      this.dispatchEvent(new CustomEvent('buzzed', { detail: payload }));
    });
  }

  /** Close and forget a specific peer — call this when someone leaves the room. */
  disconnectPeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) { pc.close(); this.peers.delete(socketId); }
    const audioEl = this.audioEls.get(socketId);
    if (audioEl) { audioEl.remove(); this.audioEls.delete(socketId); }
  }

  /** Start talking: claims one of the 4 speaking seats, then connects to
   *  every current room member (that we're not already connected to)
   *  and starts sending audio. Returns { ok, reason? }. */
  async startTalking() {
    if (this.isTalking) return { ok: true };

    if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        return { ok: false, reason: 'MIC_DENIED' };
      }
    }

    const response = await new Promise((resolve) => {
      this.socketClient.socket.emit('voice-join', {}, resolve);
    });

    if (!response?.ok) {
      return response || { ok: false, reason: 'UNKNOWN' };
    }

    this.isTalking = true;
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = true; });

    // Connect to anyone in the room we don't already have a connection
    // to (first time talking) — existing connections (from a previous
    // talking session) just resume since we re-enabled the track above.
    const roomIds = this._roomRosterIds().filter((id) => id !== this.socketClient.socket.id);
    for (const id of roomIds) {
      if (!this.peers.has(id)) {
        await this._connectTo(id, true);
      }
    }

    return { ok: true };
  }

  /** Stop talking: frees the speaking seat and mutes, but keeps
   *  connections alive so resuming is instant. */
  stopTalking() {
    if (!this.isTalking) return;
    this.isTalking = false;

    this.socketClient.socket.emit('voice-leave');
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }

  buzz() {
    this.socketClient.socket.emit('voice-buzz');
  }

  /** Called by playerUI.js when a new person joins the room while we're
   *  actively talking — they need a connection to hear us. */
  connectToNewRoomMember(socketId) {
    if (!this.isTalking || this.peers.has(socketId)) return;
    this._connectTo(socketId, true);
  }

  /** Create a peer connection to socketId. isInitiator = we send the offer. */
  async _connectTo(socketId, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.peers.set(socketId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socketClient.socket.emit('voice-signal', {
          to: socketId,
          data: { type: 'ice-candidate', candidate: e.candidate },
        });
      }
    };

    pc.ontrack = (e) => {
      let audioEl = this.audioEls.get(socketId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        this.audioEls.set(socketId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch(() => {}); // autoplay may need a retry after user gesture
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socketClient.socket.emit('voice-signal', {
        to: socketId,
        data: { type: 'offer', sdp: offer },
      });
    }

    return pc;
  }

  async _handleSignal(from, data) {
    if (data.type === 'offer') {
      // Someone's talking and connecting to us — we're purely receiving,
      // so no local track gets added even if we answer.
      const pc = this.peers.get(from) || await this._connectTo(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socketClient.socket.emit('voice-signal', {
        to: from,
        data: { type: 'answer', sdp: answer },
      });
    } else if (data.type === 'answer') {
      const pc = this.peers.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'ice-candidate') {
      const pc = this.peers.get(from);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }
}
