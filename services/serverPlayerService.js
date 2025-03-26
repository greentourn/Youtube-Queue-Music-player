// services/serverPlayerService.js
const { EventEmitter } = require('events');

/**
 * ServerPlayerService
 * Service ที่จำลองการเล่นเพลงบน server โดยไม่ต้องพึ่งพา browser
 */
class ServerPlayerService extends EventEmitter {
    constructor(youtubeService, queueService, stateService) {
        super();
        this.youtubeService = youtubeService;
        this.queueService = queueService;
        this.stateService = stateService;
        this.isPlaying = false;
        this.playTimer = null;
        this.tickInterval = null;
        this.lastTickTime = null;
        this.syncInterval = 1000; // 1 second for sync ticks
        this.defaultTickTimer = 250; // 250ms for playback simulation
        this._videoDurationCache = new Map();
        this._playingVideoChecked = false;
        this._lastCheckedVideoTime = 0;

        // สำหรับเฉพาะกรณีไม่มี client online:
        this._activeClients = 0;          // จำนวน client ที่เชื่อมต่ออยู่
        this._backupCheckEnabled = true;  // เปิดระบบตรวจสอบสำรองหรือไม่
        this._maxInactivityTime = 600;    // ความยาวเพลงเริ่มต้น (10 นาที) ในกรณีไม่มี client

    }

    // เรียกเมื่อมี client เชื่อมต่อ
    addActiveClient() {
        this._activeClients++;
        console.log(`[ServerPlayer] Active clients: ${this._activeClients}`);
    }

    // เรียกเมื่อมี client ตัดการเชื่อมต่อ
    removeActiveClient() {
        if (this._activeClients > 0) {
            this._activeClients--;
        }
        console.log(`[ServerPlayer] Active clients: ${this._activeClients}`);
    }

    /**
     * เริ่มการทำงานของ server player
     */
    start() {
        console.log('Starting server-side player service');
        // ตรวจสอบสถานะเริ่มต้น
        this._checkInitialState();

        // เริ่ม interval สำหรับการอัพเดทเวลาเพลงอย่างสม่ำเสมอ
        this.tickInterval = setInterval(() => this._tick(), this.defaultTickTimer);

        // ลงทะเบียน event listeners
        this._registerEventListeners();
    }

    /**
     * หยุดการทำงานของ server player
     */
    stop() {
        if (this.playTimer) {
            clearTimeout(this.playTimer);
            this.playTimer = null;
        }

        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.isPlaying = false;
    }

    /**
     * ตรวจสอบและอัพเดทสถานะการเล่น
     * @private
     */
    _tick() {
        const currentState = this.stateService.getState();
        const now = Date.now();
        
        // ถ้าไม่มีการเล่นเพลง หรือไม่มีเพลงในคิว
        if (!currentState.isPlaying || !currentState.videoId) {
          return;
        }
        
        // คำนวณเวลาที่ผ่านไปตั้งแต่การอัพเดทล่าสุด
        const timeElapsed = (now - currentState.lastUpdate) / 1000;
        const currentTimestamp = currentState.timestamp + timeElapsed;
        
        // ตรวจสอบว่ามี client ออนไลน์หรือไม่
        if (this._activeClients === 0 && this._backupCheckEnabled) {
          // ไม่มี client ออนไลน์ ต้องใช้ระบบสำรอง
          
          // เช็คว่าเพลงเล่นนานเกิน maxInactivityTime หรือไม่
          // เพื่อป้องกันเพลงค้างเมื่อไม่มีใครฟัง
          if (currentTimestamp > this._maxInactivityTime) {
            console.log(`[ServerPlayer] No clients online and max inactivity time (${this._maxInactivityTime}s) reached, forcing next song`);
            this._tryGetNextSong();
            return;
          }
          
          // ตรวจสอบความยาวเพลงแบบประหยัดทรัพยากร (ตรวจสอบทุก 30 วินาที)
          if (now - this.lastTickTime > 30000) {
            this.lastTickTime = now;
            
            // ดึงข้อมูลความยาวเพลงจาก cache (ถ้ามี)
            const duration = this._getVideoDurationFromCache(currentState.videoId);
            
            if (duration && currentTimestamp >= duration + 5) {
              console.log(`[ServerPlayer] Song likely ended (backup system): currentTime=${currentTimestamp}s, duration=${duration}s`);
              this._tryGetNextSong();
            }
          }
        } else {
          // มี client ออนไลน์ ไม่ต้องตรวจสอบการจบของเพลง
          // เพราะ client จะรายงานเมื่อเพลงจบ
          
          // อัพเดท timestamp ตามปกติทุก 5 วินาที
          if (now - this.lastTickTime > 5000) {
            this.lastTickTime = now;
            
            // อัพเดท timestamp เพื่อซิงค์กับ client
            const updatedState = {
              ...currentState,
              timestamp: currentTimestamp,
              lastUpdate: now
            };
            
            this.stateService.updateState(updatedState);
          }
        }
      }

      // ดึงความยาวเพลงจาก cache หรือพยายามหาจาก YouTube API แบบไม่บ่อยนัก
  async _getVideoDurationFromCache(videoId) {
    if (this._videoDurationCache.has(videoId)) {
      return this._videoDurationCache.get(videoId);
    }
    
    try {
      // ลองดึงข้อมูลจาก YouTube API
      const videoInfo = await this.youtubeService.getVideoInfo(videoId);
      if (videoInfo && videoInfo.contentDetails && videoInfo.contentDetails.duration) {
        const durationStr = videoInfo.contentDetails.duration;
        let duration = 0;
        
        const hours = durationStr.match(/(\d+)H/);
        const minutes = durationStr.match(/(\d+)M/);
        const seconds = durationStr.match(/(\d+)S/);
        
        if (hours) duration += parseInt(hours[1]) * 3600;
        if (minutes) duration += parseInt(minutes[1]) * 60;
        if (seconds) duration += parseInt(seconds[1]);
        
        // เพิ่มความยาวเพื่อความปลอดภัย
        duration += 5;
        
        // เก็บใน cache
        this._videoDurationCache.set(videoId, duration);
        return duration;
      }
    } catch (error) {
      console.log(`[ServerPlayer] Error getting video duration (backup system): ${error.message}`);
    }
    
    // ถ้าไม่สามารถหาความยาวได้ ใช้ค่าเริ่มต้น
    return this._maxInactivityTime;
  }

    /**
     * ตรวจสอบว่าเพลงจบหรือยัง
     * @param {string} videoId - video ID ของเพลงปัจจุบัน
     * @param {number} currentTime - เวลาปัจจุบันในการเล่น (วินาที)
     * @private
     */
    async _checkSongCompletion(videoId, currentTime) {
        try {
            if (!this._playingVideoChecked) {
                this._playingVideoChecked = true;
                console.log(`[ServerPlayer] Checking song completion for ${videoId} at ${currentTime}s`);
            }

            // หาความยาวของเพลงปัจจุบัน
            const songInfo = await this._getSongDuration(videoId);

            // ถ้าได้ความยาวเพลงและเวลาปัจจุบันใกล้หรือเกินความยาวเพลง
            if (songInfo) {
                // แสดงข้อมูล debug
                if (Math.abs(currentTime - songInfo.duration) < 10) {
                    console.log(`[ServerPlayer] Near song end - Current: ${currentTime}s, Duration: ${songInfo.duration}s, Difference: ${songInfo.duration - currentTime}s`);
                }

                // ถ้าเวลาปัจจุบันเกินความยาวเพลง (หรือเหลือไม่เกิน 1 วินาที)
                if (currentTime >= songInfo.duration - 1) {
                    console.log(`[ServerPlayer] Song completed: ${videoId} - Current time: ${currentTime}s, Duration: ${songInfo.duration}s`);
                    this._handleSongEnd();
                    this._playingVideoChecked = false; // รีเซ็ตสถานะเพื่อตรวจสอบเพลงใหม่
                }
            }
        } catch (error) {
            console.error('Error checking song completion:', error);
        }
    }

    /**
     * ดึงความยาวของวิดีโอ (พร้อมระบบ cache)
     * @param {string} videoId - YouTube video ID
     * @returns {Promise<{duration: number, title: string}>}
     * @private
     */
    async _getSongDuration(videoId) {
        // ตรวจสอบ cache ก่อน
        if (this._videoDurationCache.has(videoId)) {
            return this._videoDurationCache.get(videoId);
        }

        try {
            // ดึงข้อมูลวิดีโอจาก YouTube API
            const videoInfo = await this.youtubeService.getVideoInfo(videoId);
            if (!videoInfo) {
                throw new Error(`No video info for ${videoId}`);
            }

            // แปลงรูปแบบเวลา ISO 8601 ให้เป็นวินาที (PT1H2M3S -> 3723)
            let duration = 0;

            // ถ้าไม่สามารถหาความยาวได้ ให้ใช้ค่าเริ่มต้น
            if (!videoInfo.contentDetails || !videoInfo.contentDetails.duration) {
                // สมมติเป็นเพลง 4 นาที (ค่าเฉลี่ยของเพลงทั่วไป)
                console.log(`[ServerPlayer] No duration found for ${videoId}, using default 240s`);
                duration = 240;
            } else {
                const durationStr = videoInfo.contentDetails.duration;
                const hours = durationStr.match(/(\d+)H/);
                const minutes = durationStr.match(/(\d+)M/);
                const seconds = durationStr.match(/(\d+)S/);

                if (hours) duration += parseInt(hours[1]) * 3600;
                if (minutes) duration += parseInt(minutes[1]) * 60;
                if (seconds) duration += parseInt(seconds[1]);

                console.log(`[ServerPlayer] Found duration for ${videoId}: ${duration}s (${durationStr})`);
            }

            // เก็บลงใน cache
            const songInfo = {
                duration: duration,
                title: videoInfo.snippet ? videoInfo.snippet.title : `Video ${videoId}`
            };

            this._videoDurationCache.set(videoId, songInfo);
            return songInfo;
        } catch (error) {
            console.error(`Error getting video duration for ${videoId}:`, error);

            // หากเกิดข้อผิดพลาด ให้ใช้ค่าเริ่มต้น 4 นาที
            console.log(`[ServerPlayer] Using default duration for ${videoId} due to error`);
            const defaultInfo = { duration: 240, title: `Video ${videoId}` };
            this._videoDurationCache.set(videoId, defaultInfo);
            return defaultInfo;
        }
    }

    /**
     * จัดการเมื่อเพลงจบ
     * @private
     */
    _handleSongEnd() {
        console.log('[ServerPlayer] Handling song end');

        // ดึงคิวปัจจุบัน
        const queue = this.queueService.getQueue();

        // ลบเพลงปัจจุบันออกจากคิว
        if (queue.length > 0) {
            const removedSong = this.queueService.removeSong(0);
            console.log(`[ServerPlayer] Removed song from queue: ${removedSong}`);

            const updatedQueue = this.queueService.getQueue();

            // แจ้งการอัพเดทคิว
            this.emit('queueUpdated', updatedQueue);

            // เล่นเพลงถัดไปถ้ามีในคิว
            if (updatedQueue.length > 0) {
                const nextSong = updatedQueue[0];
                const nextVideoId = this._extractVideoId(nextSong);

                if (nextVideoId) {
                    console.log(`[ServerPlayer] Playing next song: ${nextVideoId}`);
                    this._playNext(nextVideoId);
                } else {
                    console.log('[ServerPlayer] Next song has invalid video ID, stopping playback');
                    this._stopPlayback();
                }
            } else {
                console.log('[ServerPlayer] No more songs in queue, stopping playback');
                this._stopPlayback();
            }
        } else {
            console.log('[ServerPlayer] Queue is empty, stopping playback');
            this._stopPlayback();
        }
    }

    /**
     * เล่นเพลงถัดไป
     * @param {string} videoId - video ID ของเพลงที่จะเล่น
     * @private
     */
    _playNext(videoId) {
        const newState = {
            videoId: videoId,
            timestamp: 0,
            isPlaying: true,
            lastUpdate: Date.now(),
        };

        // อัพเดทสถานะ
        this.stateService.updateState(newState);
        console.log(`[ServerPlayer] Updated state to play: ${videoId}`);

        // รีเซ็ตการตรวจสอบเพลง
        this._playingVideoChecked = false;
        this._lastCheckedVideoTime = 0;

        // แจ้งการเปลี่ยนสถานะ
        this.emit('playbackState', this.stateService.getState());
    }

    /**
     * หยุดเล่นเพลง
     * @private
     */
    _stopPlayback() {
        const emptyState = {
            videoId: null,
            timestamp: 0,
            isPlaying: false,
            lastUpdate: Date.now(),
        };

        // อัพเดทสถานะ
        this.stateService.updateState(emptyState);
        console.log('[ServerPlayer] Stopped playback, cleared state');

        // รีเซ็ตการตรวจสอบเพลง
        this._playingVideoChecked = false;
        this._lastCheckedVideoTime = 0;

        // แจ้งการเปลี่ยนสถานะ
        this.emit('playbackState', this.stateService.getState());
    }

    /**
     * ตรวจสอบสถานะเริ่มต้น
     * @private
     */
    _checkInitialState() {
        const currentState = this.stateService.getState();
        const queue = this.queueService.getQueue();

        console.log(`[ServerPlayer] Initial check - Current state: ${JSON.stringify(currentState)}`);
        console.log(`[ServerPlayer] Initial queue length: ${queue.length}`);

        // ถ้าไม่มีเพลงที่กำลังเล่นแต่มีคิว
        if (!currentState.videoId && queue.length > 0) {
            const firstVideoId = this._extractVideoId(queue[0]);
            if (firstVideoId) {
                console.log(`[ServerPlayer] Starting playback with first queue item: ${firstVideoId}`);
                this._playNext(firstVideoId);
            }
        } else if (currentState.videoId) {
            // ถ้ามีเพลงที่กำลังเล่นอยู่แล้ว ให้ตรวจสอบว่าตำแหน่งปัจจุบันเกินความยาวเพลงหรือไม่
            console.log(`[ServerPlayer] Checking current playing video: ${currentState.videoId}`);

            // คำนวณเวลาปัจจุบันจากเวลาที่ผ่านไป
            const now = Date.now();
            const timeDiff = (now - currentState.lastUpdate) / 1000;
            const currentTimestamp = currentState.isPlaying ?
                currentState.timestamp + timeDiff : currentState.timestamp;

            console.log(`[ServerPlayer] Current timestamp: ${currentTimestamp}s`);
            this._checkSongCompletion(currentState.videoId, currentTimestamp);
        }
    }

    /**
     * ลงทะเบียน event listeners
     * @private
     */
    _registerEventListeners() {
        // ลงทะเบียน event เมื่อมีการแจ้งว่าวิดีโอจบจาก client
        this.on('videoEnded', (data) => {
            console.log(`[ServerPlayer] Received videoEnded event for ${data.videoId}`);

            // ตรวจสอบว่าวิดีโอที่จบตรงกับวิดีโอปัจจุบันหรือไม่
            const currentState = this.stateService.getState();

            if (currentState.videoId === data.videoId) {
                console.log(`[ServerPlayer] Processing end of video ${data.videoId}`);

                // คลายการล็อคเพื่อให้ระบบสามารถเปลี่ยนเพลงได้
                this._playingVideoChecked = false;

                // ไม่จำเป็นต้องเรียก _handleSongEnd ที่นี่เนื่องจาก socketService
                // จะจัดการเปลี่ยนเพลงและอัพเดต state แล้ว
            } else {
                console.log(`[ServerPlayer] Ignoring end event for ${data.videoId} - current video is ${currentState.videoId}`);
            }
        });
    }

    /**
     * ดึง video ID จาก URL
     * @param {string} url - YouTube URL
     * @returns {string|null} - YouTube video ID หรือ null หากไม่พบ
     * @private
     */
    _extractVideoId(url) {
        if (!url || typeof url !== 'string') return null;

        const match = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    // เพิ่มฟังก์ชันเพื่อรีเซ็ต cache เมื่อจำเป็น
    resetDurationCache(videoId = null) {
        if (videoId) {
            this._videoDurationCache.delete(videoId);
        } else {
            this._videoDurationCache.clear();
        }
    }
}

module.exports = ServerPlayerService;