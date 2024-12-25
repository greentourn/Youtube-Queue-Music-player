// socketService.js
const chatWithAI = require("../ChatBot/chatAI");

class SocketService {
  constructor(io, youtubeService, queueService, stateService) {
    this.io = io;
    this.youtubeService = youtubeService;
    this.queueService = queueService;
    this.stateService = stateService;
    this.chatHistory = new Map();
    this.activeUsers = 0;
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
      console.log("New client connected");
      this.chatHistory.set(socket.id, []);
      this.activeUsers++;
      this.io.emit("activeUsers", this.activeUsers);

      // Send initial state
      socket.emit("initialState", {
        songQueue: this.queueService.getQueue(),
        currentPlaybackState: this.stateService.getState(),
      });

      socket.on("requestInitialQueue", () => {
        const currentState = this.stateService.getState();
        const queue = this.queueService.getQueue();

        socket.emit("initialState", {
          currentPlaybackState: {
            ...currentState,
            lastUpdate: Date.now(),
          },
          songQueue: queue,
        });
      });

      socket.on("getInitialState", () => {
        const queue = this.queueService.getQueue();
        const state = this.stateService.getState();
        socket.emit("queueUpdated", queue);
        socket.emit("playbackState", state);
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
              if (searchError.response?.status === 403) {
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
            const currentState = this.stateService.getState();

            // Validate and update state
            if (this.stateService.updateState(state)) {
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

      socket.on("videoEnded", async (data, callback) => {
        if (this.queueService.mutex.lock()) {
          try {
            const queue = this.queueService.getQueue();
            const currentState = this.stateService.getState();

            if (queue.length > 0) {
              const currentVideoId = this.extractVideoId(queue[0]);

              // ตรวจสอบว่าวิดีโอที่จบเป็นวิดีโอปัจจุบันหรือไม่
              if (currentVideoId === currentState.videoId) {
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
              }
            }

            // ส่ง callback เพื่อให้ client รู้ว่าเสร็จแล้ว
            if (typeof callback === "function") {
              callback();
            }
          } catch (error) {
            console.error("Error handling video ended:", error);
            if (typeof callback === "function") {
              callback(error);
            }
          } finally {
            this.queueService.mutex.unlock();
          }
        }
      });

      // Handle disconnect
      socket.on("disconnect", () => {
        this.activeUsers--;
        this.io.emit("activeUsers", this.activeUsers);
        this.chatHistory.delete(socket.id);
      });
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
