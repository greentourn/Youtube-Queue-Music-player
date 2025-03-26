// socketService.js
const chatWithAI = require("../ChatBot/chatAI");

class SocketService {
  constructor(io, youtubeService, queueService, stateService, serverPlayer) {
    this.io = io;
    this.youtubeService = youtubeService;
    this.queueService = queueService;
    this.stateService = stateService;
    this.serverPlayer = serverPlayer; // เพิ่ม reference ไปยัง ServerPlayer
    this.chatHistory = new Map();
    this.activeUsers = 0;
    this.clientSyncMap = new Map(); // เก็บสถานะการซิงค์ของแต่ละ client

    // เก็บ cache ของข้อมูลความยาววิดีโอ
    this.videoDurationCache = new Map();
    // เก็บเวลาล่าสุดที่มีการอัพเดต state เพื่อป้องกันการรีเซ็ตจาก client ใหม่
    this.lastStateUpdateTime = Date.now();
  }

  extractVideoId(url) {
    const videoIdMatch = url.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return videoIdMatch ? videoIdMatch[1] : null;
  }

  extractPlaylistId(url) {
    const playlistMatch = url.match(/[&?]list=([a-zA-Z0-9_-]+)/i);
    return playlistMatch ? playlistMatch[1] : null;
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`New client connected: ${socket.id}`);

      // เพิ่ม client เข้าสู่ระบบติดตาม
      if (this.serverPlayer) {
        this.serverPlayer.addActiveClient();
      }
      // ทำเครื่องหมายว่า client นี้เพิ่งเชื่อมต่อ ยังไม่ได้ซิงค์
      this.clientSyncMap.set(socket.id, {
        synced: false,
        joinTime: Date.now()
      });

      this.chatHistory.set(socket.id, []);
      this.activeUsers++;
      this.io.emit("activeUsers", this.activeUsers);

      // ส่งสถานะเริ่มต้นไปยัง client ใหม่แบบ one-way (client ไม่ส่ง state กลับ)
      this.sendInitialState(socket);

      socket.on("requestInitialQueue", async (_, callback) => {
        const state = await this.prepareCurrentState();
        // ทำเครื่องหมายว่า client นี้ได้รับการซิงค์แล้ว
        this.clientSyncMap.set(socket.id, {
          synced: true,
          joinTime: this.clientSyncMap.get(socket.id)?.joinTime || Date.now(),
          lastSync: Date.now()
        });

        if (typeof callback === 'function') {
          callback(state);
        } else {
          socket.emit("initialState", state);
        }
      });

      socket.on("getInitialState", async () => {
        const state = await this.prepareCurrentState();
        socket.emit("queueUpdated", state.songQueue);
        socket.emit("playbackState", state.currentPlaybackState);
      });

      // Handle chat messages
      socket.on("chat message", async (message) => {
        try {
          const currentVideoId = this.stateService.getState().videoId;
          let currentSong = null;

          if (currentVideoId) {
            try {
              const videoDetails = await this.youtubeService.getVideoInfo(
                currentVideoId
              );
              currentSong = {
                title: videoDetails.title,
                videoId: currentVideoId,
              };
            } catch (error) {
              console.error("Error fetching video details:", error);
            }
          }

          // Update chat history
          const history = this.chatHistory.get(socket.id);
          history.push({ role: "user", content: message });
          if (history.length > 10) history.shift();

          // Get AI response
          const response = await chatWithAI(
            history,
            currentSong,
            this.queueService.getQueue()
          );
          history.push({ role: "assistant", content: response });

          // Handle commands
          const commandMatch = response.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);
          if (commandMatch) {
            const command = commandMatch[1];
            const param = commandMatch[2];

            switch (command) {
              case "play":
                if (
                  !this.stateService.getState().isPlaying &&
                  this.stateService.getState().videoId
                ) {
                  this.stateService.updateState({
                    ...this.stateService.getState(),
                    isPlaying: true,
                    lastUpdate: Date.now(),
                  });
                  this.io.emit("playbackState", this.stateService.getState());
                }
                break;

              case "pause":
                if (this.stateService.getState().isPlaying) {
                  const currentTime = Date.now();
                  const currentState = this.stateService.getState();
                  const timeDiff =
                    (currentTime - currentState.lastUpdate) / 1000;

                  this.stateService.updateState({
                    ...currentState,
                    timestamp:
                      currentState.timestamp +
                      (currentState.isPlaying ? timeDiff : 0),
                    isPlaying: false,
                    lastUpdate: currentTime,
                  });
                  this.io.emit("playbackState", this.stateService.getState());
                }
                break;

              case "skip":
                if (this.queueService.getQueue().length > 0) {
                  this.queueService.removeSong(0);
                  this.io.emit("queueUpdated", this.queueService.getQueue());

                  if (this.queueService.getQueue().length > 0) {
                    const nextVideoId = this.extractVideoId(
                      this.queueService.getQueue()[0]
                    );
                    this.stateService.updateState({
                      videoId: nextVideoId,
                      timestamp: 0,
                      isPlaying: true,
                      lastUpdate: Date.now(),
                    });
                  } else {
                    this.stateService.updateState({
                      videoId: null,
                      timestamp: 0,
                      isPlaying: false,
                      lastUpdate: Date.now(),
                    });
                  }
                  this.io.emit("playbackState", this.stateService.getState());
                }
                break;

              case "clear":
                this.queueService.clearQueue();
                this.io.emit("queueUpdated", this.queueService.getQueue());
                break;

              case "remove":
                if (
                  param &&
                  Number(param) > 0 &&
                  Number(param) < this.queueService.getQueue().length
                ) {
                  this.queueService.removeSong(Number(param));
                  this.io.emit("queueUpdated", this.queueService.getQueue());
                }
                break;
            }

            socket.emit("chat response", {
              message: response.replace(/\[COMMAND:\w+(?::\d+)?\]/g, "").trim(),
              isCommand: true,
            });
            return;
          }

          // Handle search
          const searchMatch = response.match(/\[SEARCH:(.*?)\]/);
          if (searchMatch) {
            const searchQuery = searchMatch[1].trim();
            try {
              console.log("Initiating YouTube search:", searchQuery);
              const searchResults = await this.youtubeService.searchVideos(
                searchQuery
              );
              if (searchResults.length > 0) {
                socket.emit("search results", {
                  results: searchResults,
                  message: response.replace(/\[SEARCH:.*?\]/, "").trim(),
                });
              } else {
                socket.emit("chat response", {
                  message:
                    "ขออภัย ฉันไม่พบเพลงที่คุณต้องการ กรุณาลองใหม่อีกครั้ง",
                  isCommand: false,
                });
              }
              return;
            } catch (searchError) {
              console.error("Search error details:", searchError);

              // ส่งข้อความ error ที่เฉพาะเจาะจงมากขึ้น
              let errorMessage = "ขออภัย เกิดข้อผิดพลาดในการค้นหาเพลง";
              if (searchError.response?.status === 403 || searchError.response?.status === 429) {
                errorMessage += " (API quota exceeded)";
              } else if (searchError.code === "ETIMEDOUT") {
                errorMessage += " (timeout)";
              }

              socket.emit("chat response", {
                message: errorMessage,
                isCommand: false,
              });
            }
            return;
          }

          // Send normal response
          socket.emit("chat response", {
            message: response,
            isCommand: false,
          });
        } catch (error) {
          console.error("Error processing chat:", error);
          socket.emit("chat response", {
            message: "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง",
            isCommand: false,
          });
        }
      });

      // Handle playback state updates
      socket.on("updatePlaybackState", (state, callback) => {
        if (this.queueService.mutex.lock()) {
          try {
            const clientInfo = this.clientSyncMap.get(socket.id);
            const currentState = this.stateService.getState();
            const now = Date.now();

            // ตรวจสอบว่า client นี้ได้รับการซิงค์แล้วหรือไม่
            if (!clientInfo || !clientInfo.synced) {
              console.log(`[SocketService] Rejecting state update from unsynced client: ${socket.id}`);
              if (typeof callback === "function") {
                callback(false);
              }
              return;
            }

            // ป้องกัน client ใหม่ที่เพิ่งเชื่อมต่อไม่ให้รีเซ็ต timestamp
            if (now - clientInfo.joinTime < 5000 && state.timestamp < 5) {
              console.log(`[SocketService] New client trying to reset timestamp, ignoring`);
              // ส่ง state ปัจจุบันกลับไปที่ client แทน
              socket.emit("playbackState", this.stateService.getState());
              if (typeof callback === "function") {
                callback(false);
              }
              return;
            }

            // ป้องกันการรีเซ็ต timestamp ถ้า server มีการเล่นมาสักพักแล้ว
            if (currentState.videoId === state.videoId &&
              currentState.timestamp > 10 &&
              state.timestamp < 3 &&
              now - this.lastStateUpdateTime > 5000) {
              console.log(`[SocketService] Preventing timestamp reset: server=${currentState.timestamp}s, client=${state.timestamp}s`);
              // ส่ง state ล่าสุดกลับไปให้ client แทน
              socket.emit("playbackState", this.stateService.getState());
              if (typeof callback === "function") {
                callback(false);
              }
              return;
            }

            // อัพเดท state เฉพาะกรณีที่ผ่านการตรวจสอบแล้ว
            if (this.stateService.updateState(state)) {
              this.lastStateUpdateTime = now;

              // อัพเดทสถานะ sync ของ client นี้
              this.clientSyncMap.set(socket.id, {
                ...clientInfo,
                lastSync: now
              });

              // Broadcast to all clients except sender
              socket.broadcast.emit(
                "playbackState",
                this.stateService.getState()
              );

              // Acknowledge successful update
              if (typeof callback === "function") {
                callback(true);
              }
            }
          } catch (error) {
            console.error("Error updating playback state:", error);
            if (typeof callback === "function") {
              callback(false);
            }
          } finally {
            this.queueService.mutex.unlock();
          }
        }
      });

      // Handle adding songs
      socket.on("addSong", async (input) => {
        const videoId = this.extractVideoId(input);
        const playlistId = this.extractPlaylistId(input);

        if (playlistId && videoId) {
          try {
            const videos = await this.youtubeService.getPlaylistItems(
              playlistId,
              videoId
            );
            socket.emit("playlistFound", {
              videos,
              playlistId,
              originalVideo: input,
            });
          } catch (error) {
            console.error("Error fetching playlist:", error);
            if (videoId) {
              this.handleSingleVideo(videoId, input);
            }
          }
        } else if (videoId) {
          this.handleSingleVideo(videoId, input);
        }
      });

      // Handle skipping songs
      socket.on("skipSong", async () => {
        if (this.queueService.mutex.lock()) {
          try {
            const queue = this.queueService.getQueue();
            if (queue.length > 0) {
              // Remove current song
              this.queueService.removeSong(0);

              // Get updated queue
              const updatedQueue = this.queueService.getQueue();

              // Broadcast queue update
              this.io.emit("queueUpdated", updatedQueue);

              // Play next song if available
              if (updatedQueue.length > 0) {
                const nextVideoId = this.extractVideoId(updatedQueue[0]);
                if (nextVideoId) {
                  const newState = {
                    videoId: nextVideoId,
                    timestamp: 0,
                    isPlaying: true,
                    lastUpdate: Date.now(),
                  };
                  this.stateService.updateState(newState);
                  this.io.emit("playbackState", this.stateService.getState());
                }
              } else {
                // No more songs in queue
                const emptyState = {
                  videoId: null,
                  timestamp: 0,
                  isPlaying: false,
                  lastUpdate: Date.now(),
                };
                this.stateService.updateState(emptyState);
                this.io.emit("playbackState", this.stateService.getState());
              }
            }
          } catch (error) {
            console.error("Error handling skip song:", error);
          } finally {
            this.queueService.mutex.unlock();
          }
        }
      });

      // Handle removing songs
      socket.on("removeSong", (index) => {
        const removedSong = this.queueService.removeSong(index);
        if (removedSong) {
          this.io.emit("queueUpdated", this.queueService.getQueue());

          if (index === 0) {
            if (this.queueService.getQueue().length > 0) {
              const nextVideoId = this.extractVideoId(
                this.queueService.getQueue()[0]
              );
              this.stateService.updateState({
                videoId: nextVideoId,
                timestamp: 0,
                isPlaying: true,
                lastUpdate: Date.now(),
              });
            } else {
              this.stateService.updateState({
                videoId: null,
                timestamp: 0,
                isPlaying: false,
                lastUpdate: Date.now(),
              });
            }
            this.io.emit("playbackState", this.stateService.getState());
          }
        }
      });

      // Handle moving songs
      socket.on("moveSong", (fromIndex, toIndex) => {
        if (this.queueService.moveSong(fromIndex, toIndex)) {
          this.io.emit("queueUpdated", this.queueService.getQueue());
        }
      });

      // Handle adding playlist videos
      socket.on("addPlaylistVideos", (videos) => {
        this.queueService.addPlaylistVideos(videos);
        this.io.emit("queueUpdated", this.queueService.getQueue());

        if (
          !this.stateService.getState().videoId ||
          !this.stateService.getState().isPlaying
        ) {
          const firstVideoId = this.extractVideoId(videos[0]);
          if (firstVideoId) {
            this.stateService.updateState({
              videoId: firstVideoId,
              timestamp: 0,
              isPlaying: true,
              lastUpdate: Date.now(),
            });
            this.io.emit("playbackState", this.stateService.getState());
          }
        }
      });

      // Handle clearing queue
      socket.on("clearQueue", () => {
        this.queueService.clearQueue();
        this.io.emit("queueUpdated", this.queueService.getQueue());
      });

      // Handle playing song from queue
      socket.on("playSongFromQueue", (index) => {
        if (index >= 0 && index < this.queueService.getQueue().length) {
          const songToPlay = this.queueService.getQueue()[index];
          this.queueService.removeSong(index);
          this.io.emit("queueUpdated", this.queueService.getQueue());

          const videoId = this.extractVideoId(songToPlay);
          this.stateService.updateState({
            videoId: videoId,
            timestamp: 0,
            isPlaying: true,
            lastUpdate: Date.now(),
          });
          this.io.emit("playbackState", this.stateService.getState());
        }
      });

      socket.on("checkQueue", () => {
        if (this.queueService.getQueue().length > 0) {
          const nextVideoId = this.extractVideoId(
            this.queueService.getQueue()[0]
          );
          if (nextVideoId) {
            const newState = {
              videoId: nextVideoId,
              timestamp: 0,
              isPlaying: true,
              lastUpdate: Date.now(),
            };
            this.stateService.updateState(newState);
            this.io.emit("playbackState", this.stateService.getState());
          }
        }
      });

      // Queue and playback state sync
      socket.on("queueUpdated", (queue) => {
        console.log("Received queue update:", queue);
        this.queueService.songQueue = [...queue];
        this.io.emit("queueUpdated", this.queueService.getQueue());
      });

      socket.on("playbackState", (state) => {
        console.log("Received playback state:", state);
        this.stateService.updateState(state);
        this.io.emit("playbackState", this.stateService.getState());
      });

      // แก้ไขการจัดการ videoEnded ให้เชื่อมกับ ServerPlayerService
      socket.on("videoEnded", async (data, callback) => {
        console.log("Video ended event received from client:", data);

        if (this.queueService.mutex.lock()) {
          try {
            // บันทึก log และตรวจสอบว่าตรงกับเพลงที่เล่นอยู่จริงๆ หรือไม่
            const currentState = this.stateService.getState();

            if (data.videoId === currentState.videoId) {
              console.log(`Confirmed: Video ${data.videoId} has ended`);

              // เรียก ServerPlayer เพื่อจัดการเล่นเพลงถัดไป
              this.serverPlayer.emit('videoEnded', data);

              // ลบเพลงปัจจุบันออกจากคิว
              this.queueService.removeSong(0);
              const updatedQueue = this.queueService.getQueue();

              // ส่งการอัพเดทคิวไปยังทุกเครื่อง
              this.io.emit("queueUpdated", updatedQueue);

              // เล่นเพลงถัดไปถ้ามี
              if (updatedQueue.length > 0) {
                const nextVideoId = this.extractVideoId(updatedQueue[0]);
                if (nextVideoId) {
                  const newState = {
                    videoId: nextVideoId,
                    timestamp: 0,
                    isPlaying: true,
                    lastUpdate: Date.now(),
                  };
                  this.stateService.updateState(newState);
                  this.io.emit("playbackState", this.stateService.getState());
                }
              } else {
                // ไม่มีเพลงในคิวแล้ว
                const emptyState = {
                  videoId: null,
                  timestamp: 0,
                  isPlaying: false,
                  lastUpdate: Date.now(),
                };
                this.stateService.updateState(emptyState);
                this.io.emit("playbackState", this.stateService.getState());
              }
            } else {
              console.log(`Ignored: Video end event for ${data.videoId} doesn't match current ${currentState.videoId}`);
            }

            // ส่ง callback กลับไปที่ client
            if (typeof callback === "function") {
              callback({
                success: true,
                message: "Video end event processed",
                nextSong: this.queueService.getQueue()[0] || null
              });
            }
          } catch (error) {
            console.error("Error handling video ended:", error);
            if (typeof callback === "function") {
              callback({
                success: false,
                error: "Failed to process video end"
              });
            }
          } finally {
            this.queueService.mutex.unlock();
          }
        }
      });

      // จัดการกรณี disconnect
      socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
        this.activeUsers--;
        this.io.emit("activeUsers", this.activeUsers);
        this.chatHistory.delete(socket.id);
        this.clientSyncMap.delete(socket.id);

        // แจ้ง serverPlayer ว่ามี client ตัดการเชื่อมต่อ
        if (this.serverPlayer) {
          this.serverPlayer.removeActiveClient();
        }
      });
    });

    // เพิ่ม Event Listener สำหรับ ServerPlayer
    if (this.serverPlayer) {
      this.serverPlayer.on('videoEnded', () => {
        console.log('[SocketService] Received videoEnded event from ServerPlayer');
      });
    }
  }

  // เพิ่มเมธอดใหม่สำหรับ prepare state ที่พร้อมส่งไปยัง client
  async prepareCurrentState() {
    const currentState = this.stateService.getState();
    const queue = this.queueService.getQueue();
    const now = Date.now();

    // คำนวณเวลาที่ผ่านไปตั้งแต่อัพเดทล่าสุด
    const timeDiff = (now - currentState.lastUpdate) / 1000;
    const adjustedTimestamp = currentState.isPlaying
      ? currentState.timestamp + timeDiff
      : currentState.timestamp;

    // ถ้ามีวิดีโอกำลังเล่น ให้ตรวจสอบความยาวของวิดีโอ
    if (currentState.videoId && !currentState.duration) {
      try {
        const videoInfo = await this.youtubeService.getVideoInfo(currentState.videoId);
        if (videoInfo.contentDetails && videoInfo.contentDetails.duration) {
          // แปลง duration จาก ISO 8601 Duration format เป็นวินาที
          const durationStr = videoInfo.contentDetails.duration;
          let duration = 0;

          const hours = durationStr.match(/(\d+)H/);
          const minutes = durationStr.match(/(\d+)M/);
          const seconds = durationStr.match(/(\d+)S/);

          if (hours) duration += parseInt(hours[1]) * 3600;
          if (minutes) duration += parseInt(minutes[1]) * 60;
          if (seconds) duration += parseInt(seconds[1]);

          // อัพเดท state ด้วยความยาวของวิดีโอ
          currentState.duration = duration;
          this.stateService.setVideoDuration(currentState.videoId, duration);

          console.log(`[SocketService] Retrieved duration for ${currentState.videoId}: ${duration}s`);
        }
      } catch (error) {
        console.error(`[SocketService] Error getting video duration: ${error.message}`);
      }
    }

    return {
      songQueue: queue,
      currentPlaybackState: {
        ...currentState,
        timestamp: adjustedTimestamp,
        lastUpdate: now
      }
    };
  }

  // เพิ่มเมธอดใหม่สำหรับส่งสถานะเริ่มต้นไปยัง client
  async sendInitialState(socket) {
    const state = await this.prepareCurrentState();

    // ส่งสถานะไปยัง client โดยไม่ทำเครื่องหมายว่าซิงค์แล้ว
    // client ต้องเรียก requestInitialQueue เพื่อยืนยันการซิงค์
    socket.emit("initialState", state);

    // เพิ่ม flag สำหรับป้องกันการฟังก์ชัน updatePlaybackState ใน client
    socket.emit("clientConfig", {
      waitForSync: true,
      joinTime: Date.now()
    });
  }

  handleSingleVideo(videoId, input) {
    this.queueService.addSong(input);
    this.io.emit("queueUpdated", this.queueService.getQueue());

    const currentState = this.stateService.getState();
    if (!currentState.videoId || !currentState.isPlaying) {
      const newState = {
        videoId,
        timestamp: 0,
        isPlaying: true,
        lastUpdate: Date.now(),
      };
      this.stateService.updateState(newState);
      this.io.emit("playbackState", this.stateService.getState());
    }
  }
}

module.exports = SocketService;