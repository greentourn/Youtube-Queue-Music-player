class StateService {
  constructor() {
    this.currentPlaybackState = {
      videoId: null,
      timestamp: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      syncAttempts: 0,
      lastSyncTime: null,
      duration: null, // เพิ่มข้อมูลความยาวของวิดีโอ
    };
    this.stateUpdateBuffer = [];
    this.maxBufferSize = 10;
    this.syncThreshold = 2; // seconds
    this.lastStateCheckTime = Date.now();
  }

  getState() {
    // ตรวจสอบและคำนวณเวลาที่ผ่านไปโดยอัตโนมัติ
    if (this.currentPlaybackState.isPlaying) {
      const now = Date.now();
      const timeSinceLastCheck = (now - this.lastStateCheckTime) / 1000;
      
      // อัพเดทเฉพาะเมื่อเวลาผ่านไปอย่างน้อย 0.5 วินาที
      if (timeSinceLastCheck >= 0.5) {
        this.lastStateCheckTime = now;
        
        // คำนวณเวลาที่ผ่านไปและอัพเดท timestamp
        const timeDiff = (now - this.currentPlaybackState.lastUpdate) / 1000;
        this.currentPlaybackState.timestamp += timeDiff;
        this.currentPlaybackState.lastUpdate = now;
        
        // ตรวจสอบว่าเพลงจบแล้วหรือยัง
        if (this.currentPlaybackState.duration && 
            this.currentPlaybackState.timestamp >= this.currentPlaybackState.duration - 1) {
          console.log('[StateService] Video ended based on duration check');
          // ไม่ต้องทำอะไรที่นี่เพราะ ServerPlayerService จะตรวจจับเอง
        }
      }
    }
    
    return this.currentPlaybackState;
  }

  // คำนวณเวลาปัจจุบันของวิดีโอโดยไม่อัพเดทสถานะ
  getCurrentTimestamp() {
    if (!this.currentPlaybackState.isPlaying) {
      return this.currentPlaybackState.timestamp;
    }
    
    const now = Date.now();
    const timeDiff = (now - this.currentPlaybackState.lastUpdate) / 1000;
    return this.currentPlaybackState.timestamp + timeDiff;
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

        // ถ้ามีการเปลี่ยนวิดีโอ ให้รีเซ็ตสถานะซิงค์และความยาววิดีโอ
        if (state.videoId !== this.currentPlaybackState.videoId) {
          console.log(`[StateService] Video changed: ${this.currentPlaybackState.videoId} -> ${state.videoId}`);
          state.syncAttempts = 0;
          state.lastSyncTime = now;
          
          // ถ้ามี duration ให้นำมาใช้ ถ้าไม่มีให้เป็น null
          state.duration = state.duration || null;
        } else {
          // ถ้าเป็นวิดีโอเดียวกัน แต่มีการอัพเดท duration
          if (state.duration && (!this.currentPlaybackState.duration || 
              state.duration !== this.currentPlaybackState.duration)) {
            console.log(`[StateService] Duration updated: ${this.currentPlaybackState.duration} -> ${state.duration}`);
          }
          // คงค่า duration เดิมไว้ถ้าไม่มีค่าใหม่
          state.duration = state.duration || this.currentPlaybackState.duration;
        }

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
          syncAttempts: state.syncAttempts || 0,
          lastSyncTime: state.lastSyncTime || now,
        };
        
        this.lastStateCheckTime = now;

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

  // ตรวจสอบว่าต้องซิงค์ใหม่หรือไม่
  needsResync(clientTime, clientState) {
    if (!clientState || !this.currentPlaybackState.videoId) return false;

    const serverState = this.getState();
    
    // ถ้าเป็นคนละวิดีโอ ต้องซิงค์แน่นอน
    if (clientState.videoId !== serverState.videoId) {
      return true;
    }
    
    // คำนวณความแตกต่างของเวลาระหว่าง client และ server
    const clientAdjustedTime = clientState.timestamp +
        (clientTime - clientState.lastUpdate) / 1000;
        
    const serverAdjustedTime = serverState.timestamp + 
        (clientTime - serverState.lastUpdate) / 1000;
        
    const timeDiff = Math.abs(clientAdjustedTime - serverAdjustedTime);

    return timeDiff > this.syncThreshold;
  }

  // จัดการกรณีซิงค์ไม่สำเร็จ
  handleFailedSync() {
    this.currentPlaybackState.syncAttempts++;
    return this.currentPlaybackState.syncAttempts < 3;
  }
  
  // เพิ่มข้อมูลความยาวของวิดีโอ
  setVideoDuration(videoId, duration) {
    if (this.currentPlaybackState.videoId === videoId) {
      this.currentPlaybackState.duration = duration;
      console.log(`[StateService] Set duration for ${videoId}: ${duration}s`);
      return true;
    }
    return false;
  }
}

module.exports = StateService;