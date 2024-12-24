class StateService {
  constructor() {
    this.currentPlaybackState = {
      videoId: null,
      timestamp: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      syncAttempts: 0,
      lastSyncTime: null,
    };
    this.stateUpdateBuffer = [];
    this.maxBufferSize = 10;
    this.syncThreshold = 2; // seconds
  }

  getState() {
    return this.currentPlaybackState;
  }

  updateState(state) {
    if (this.validateState(state)) {
      const now = Date.now();

      // Prevent backdated updates
      if (
        !this.currentPlaybackState.lastUpdate ||
        state.lastUpdate >= this.currentPlaybackState.lastUpdate
      ) {
        // Calculate real timestamp based on time passed
        const timeDiff = (now - state.lastUpdate) / 1000;
        const adjustedTimestamp = state.isPlaying
          ? state.timestamp + Math.max(0, timeDiff)
          : state.timestamp;

        // Buffer the state update
        this.addToStateBuffer({
          ...state,
          timestamp: adjustedTimestamp,
          lastUpdate: now,
        });

        // Update current state
        this.currentPlaybackState = {
          ...state,
          timestamp: adjustedTimestamp,
          lastUpdate: now,
          syncAttempts: 0,
          lastSyncTime: now,
        };

        return true;
      }
    }
    return false;
  }

  validateState(state) {
    return (
      state &&
      typeof state.timestamp === "number" &&
      typeof state.isPlaying === "boolean" &&
      typeof state.lastUpdate === "number" &&
      (state.videoId === null || typeof state.videoId === "string")
    );
  }

  addToStateBuffer(state) {
    this.stateUpdateBuffer.push(state);
    if (this.stateUpdateBuffer.length > this.maxBufferSize) {
      this.stateUpdateBuffer.shift();
    }
  }

  // New method to check if resync is needed
  needsResync(clientTime, clientState) {
    if (!clientState || !this.currentPlaybackState.videoId) return false;

    const serverState = this.getState();
    const timeDiff = Math.abs(
      clientState.timestamp +
        (clientTime - clientState.lastUpdate) / 1000 -
        (serverState.timestamp + (clientTime - serverState.lastUpdate) / 1000)
    );

    return timeDiff > this.syncThreshold;
  }

  // New method to handle failed sync attempts
  handleFailedSync() {
    this.currentPlaybackState.syncAttempts++;
    return this.currentPlaybackState.syncAttempts < 3;
  }
}

module.exports = StateService;
