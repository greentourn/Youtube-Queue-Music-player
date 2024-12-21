class StateService {
    constructor() {
      this.currentPlaybackState = {
        videoId: null,
        timestamp: 0,
        isPlaying: false,
        lastUpdate: Date.now()
      };
    }
  
    getState() {
      return this.currentPlaybackState;
    }
  
    updateState(state) {
      if (this.validateState(state)) {
        this.currentPlaybackState = {
          ...state,
          lastUpdate: Date.now()
        };
        return true;
      }
      return false;
    }
  
    validateState(state) {
      return state &&
        typeof state.timestamp === 'number' &&
        typeof state.isPlaying === 'boolean' &&
        typeof state.lastUpdate === 'number';
    }
  }
  
  module.exports = StateService;