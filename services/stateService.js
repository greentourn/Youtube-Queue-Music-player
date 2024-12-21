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
        const now = Date.now();
        // ป้องกันการอัพเดทย้อนหลัง
        if (!this.currentPlaybackState.lastUpdate || 
            state.lastUpdate >= this.currentPlaybackState.lastUpdate) {
            this.currentPlaybackState = {
                ...state,
                lastUpdate: now
            };
            return true;
        }
      }
      return false;
    }
  
    validateState(state) {
      return state &&
        typeof state.timestamp === 'number' &&
        typeof state.isPlaying === 'boolean' &&
        typeof state.lastUpdate === 'number'&&
        // เพิ่มการตรวจสอบ videoId
        (state.videoId === null || typeof state.videoId === 'string');
    }
  }
  
  module.exports = StateService;