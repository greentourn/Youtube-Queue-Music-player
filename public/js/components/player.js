// components/player.js
import { getServerTime } from "../services/uiService.js";
import { fetchVideoDetails } from "../services/youtubeService-client.js";
import {
  debounce,
  formatDuration,
  handleAsyncOperation,
} from "../utils/helpers.js";

let player;
let isProcessingStateUpdate = false;
let lastKnownState = null;
let syncInterval;
let isInitialSync = true;
let isUserInteracting = false;
let wasPlayingBeforeHidden = false;
let userInteractionTimeout;
let userSeekTimeout = null;
let initialSyncCompleted = false; // เพิ่มตัวแปรใหม่เพื่อตรวจสอบว่าซิงค์ครั้งแรกเสร็จสิ้นแล้ว
let clientJoinTime = Date.now(); // เก็บเวลาที่ client เชื่อมต่อ
let waitForInitialSync = true; // ตัวแปรป้องกันการส่ง state ก่อนได้รับการซิงค์

const INTERACTION_TIMEOUT = 3000;
const SYNC_INTERVAL = 1000;
const SEEK_DELAY = 500;
const SYNC_THRESHOLD = 3; // ค่า threshold ในการซิงค์เวลาเพิ่มขึ้นเป็น 3 วินาทีเพื่อให้น้อยลง

export function initializePlayer(socket) {
  function initYouTubePlayer() {
    if (!document.getElementById("player")) {
      console.error("Player container not found");
      return;
    }

    try {
      createPlayer(socket);
      setupSocketListeners(socket);
      startStateSync(socket);
      setupVisibilityHandler(socket);
    } catch (error) {
      console.error("Error initializing player:", error);
      // Retry initialization after a delay
      setTimeout(() => initYouTubePlayer(), 1000);
    }
  }

  // Check if YT API is ready
  if (window.YT && window.YT.Player) {
    initYouTubePlayer();
  } else {
    // If not ready, set up the callback and inject the API
    window.onYouTubeIframeAPIReady = initYouTubePlayer;

    // Inject YouTube API if not already present
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }
}

function setupVisibilityHandler(socket) {
  document.addEventListener("visibilitychange", async () => {
    if (!player) return;

    if (document.hidden) {
      wasPlayingBeforeHidden =
        player.getPlayerState() === YT.PlayerState.PLAYING;
    } else {
      // ขอข้อมูลล่าสุดจาก server ทุกครั้งที่กลับมา
      socket.emit("requestInitialQueue", null, async (response) => {
        if (response?.currentPlaybackState) {
          const serverNow = getServerTime();
          await handlePlaybackStateUpdate(
            response.currentPlaybackState,
            serverNow
          );
          lastKnownState = response.currentPlaybackState;
        }
      });
    }
  });
}

async function createPlayer(socket) {
  const playerContainer = document.getElementById("player");
  if (!playerContainer) return;

  try {
    player = new YT.Player("player", {
      height: "480",
      width: "100%",
      videoId: "",
      events: {
        onReady: () => {
          window.player = player; // Set global player after it's ready
          onPlayerReady(socket);
        },
        onStateChange: (event) => onPlayerStateChange(event, socket),
        onError: (error) => {
          console.error("YouTube Player Error:", error);
          handlePlayerError(error, socket);
        },
      },
      playerVars: {
        controls: 1,
        rel: 0,
        fs: 1,
        modestbranding: 1,
        playsinline: 1,
        enablejsapi: 1,
      },
    });
  } catch (error) {
    console.error("Error creating YouTube player:", error);
    throw error;
  }
}

function handlePlayerError(error, socket) {
  isProcessingStateUpdate = false;

  switch (error.data) {
    case 2:
      console.error("Invalid video ID");
      socket.emit("videoError", { type: "invalid_id" });
      break;
    case 5:
      console.error("HTML5 player error");
      socket.emit("videoError", { type: "html5_error" });
      break;
    case 100:
      console.error("Video not found or removed");
      socket.emit("videoError", { type: "not_found" });
      break;
    case 101:
    case 150:
      console.error("Video not embeddable");
      socket.emit("videoError", { type: "not_embeddable" });
      break;
  }

  // Request next video in queue after error
  socket.emit("skipSong");
}

// เพิ่มฟังก์ชันตรวจสอบสถานะของ player
function isPlayerReady() {
  return (
    player &&
    typeof player.getPlayerState === "function" &&
    typeof player.getCurrentTime === "function" &&
    typeof player.getVideoData === "function" &&
    typeof player.loadVideoById === "function"
  );
}

function onPlayerReady(socket) {
  socket.emit("requestInitialQueue");
  initializePlayerState(socket);
}

async function initializePlayerState(socket) {
  try {
    const response = await handleAsyncOperation(fetch("/current-state"), {
      loadingMessage: "กำลังโหลดสถานะเริ่มต้น...",
      errorMessage: "ไม่สามารถโหลดสถานะเริ่มต้นได้",
    });

    const { currentPlaybackState, songQueue } = await response.json();

    if (currentPlaybackState.videoId) {
      const serverTime = getServerTime();
      
      // ปรับปรุงให้คำนวณเวลาที่ผ่านไปอย่างแม่นยำ
      const timeDiff = (serverTime - currentPlaybackState.lastUpdate) / 1000;
      const startSeconds =
        currentPlaybackState.timestamp +
        (currentPlaybackState.isPlaying ? timeDiff : 0);

      isProcessingStateUpdate = true;

      // Keep track of current state
      lastKnownState = {
        ...currentPlaybackState,
        timestamp: startSeconds,
      };

      // ทำเครื่องหมายว่าได้รับการซิงค์แล้ว
      waitForInitialSync = false;
      
      player.loadVideoById({
        videoId: currentPlaybackState.videoId,
        startSeconds: startSeconds,
      });

      await updateNowPlaying(currentPlaybackState.videoId);
      
      // หลังจากโหลดวิดีโอเรียบร้อย ทำเครื่องหมายว่าซิงค์เสร็จสิ้น
      initialSyncCompleted = true;
    }

    isProcessingStateUpdate = false;
  } catch (error) {
    console.error("Error fetching initial state:", error);
    isProcessingStateUpdate = false;
  }
}

function onPlayerStateChange(event, socket) {
  if (isProcessingStateUpdate) return;

  switch (event.data) {
    case YT.PlayerState.PLAYING:
      console.log("Video playing");
      if (!document.hidden) {
        broadcastCurrentState(socket);
      }
      break;
    case YT.PlayerState.PAUSED:
      console.log("Video paused");
      if (!document.hidden) {
        broadcastCurrentState(socket);
      }
      break;
    case YT.PlayerState.ENDED:
      console.log("Video ended event detected by YouTube API");
      handleVideoEnded(socket);
      break;
  }
}

const debouncedBroadcastState = debounce((socket) => {
  if (
    !isProcessingStateUpdate &&
    player &&
    player.getCurrentTime &&
    !isUserInteracting
  ) {
    const currentState = {
      videoId: player.getVideoData()?.video_id,
      timestamp: player.getCurrentTime(),
      isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      lastUpdate: getServerTime(),
    };
    lastKnownState = currentState;
    socket.emit("updatePlaybackState", currentState);
  }
}, 500);

function startUserInteraction() {
  isUserInteracting = true;
  if (userInteractionTimeout) {
    clearTimeout(userInteractionTimeout);
  }
}

function endUserInteraction(socket) {
  if (userInteractionTimeout) {
    clearTimeout(userInteractionTimeout);
  }
  userInteractionTimeout = setTimeout(() => {
    isUserInteracting = false;
    if (player && player.getCurrentTime) {
      broadcastCurrentState(socket);
    }
  }, INTERACTION_TIMEOUT);
}

function setupPlayerListeners(socket) {
  const videoElement = player.getIframe();

  videoElement.addEventListener("mousedown", () => {
    clearTimeout(userSeekTimeout);
    isProcessingStateUpdate = true;
  });

  videoElement.addEventListener("mouseup", () => {
    userSeekTimeout = setTimeout(() => {
      isProcessingStateUpdate = false;
      broadcastCurrentState(socket);
    }, SEEK_DELAY);
  });
}

function setupSocketListeners(socket) {
  // เพิ่ม handler สำหรับการตั้งค่า client
  socket.on("clientConfig", (config) => {
    waitForInitialSync = config.waitForSync;
    clientJoinTime = config.joinTime || Date.now();
    console.log(`Received client config, waitForSync: ${waitForInitialSync}`);
  });

  socket.on("playbackState", async (state) => {
    if (!player || !player.loadVideoById) return;
    if (state.lastUpdate <= (lastKnownState?.lastUpdate || 0)) return;

    isProcessingStateUpdate = true;
    try {
      const serverNow = getServerTime();
      await handlePlaybackStateUpdate(state, serverNow);
      lastKnownState = state;
      
      // อัพเดทสถานะการซิงค์
      if (isInitialSync) {
        isInitialSync = false;
        initialSyncCompleted = true;
        console.log('Initial sync completed');
      }
    } catch (error) {
      console.error("Error handling playback state:", error);
    } finally {
      isProcessingStateUpdate = false;
    }
  });

  // Add handler for initial state request response
  socket.on("initialState", async (state) => {
    if (!state.currentPlaybackState.videoId) return;

    isProcessingStateUpdate = true;
    try {
      const serverNow = getServerTime();
      await handlePlaybackStateUpdate(state.currentPlaybackState, serverNow);
      lastKnownState = state.currentPlaybackState;
      
      // ทำเครื่องหมายว่าได้รับการซิงค์เริ่มต้นแล้ว
      setTimeout(() => {
        waitForInitialSync = false;
        initialSyncCompleted = true;
        console.log('Initial state sync completed');
      }, 2000); // รอสักครู่ก่อนยืนยันว่าซิงค์เสร็จ
    } catch (error) {
      console.error("Error handling initial state:", error);
    } finally {
      isProcessingStateUpdate = false;
    }
  });
}

async function handlePlaybackStateUpdate(state, serverNow) {
  if (!isPlayerReady() || !state.videoId) return;

  try {
    const currentVideoId = player.getVideoData()?.video_id;
    
    // คำนวณเวลาที่ผ่านไปด้วยความแม่นยำมากขึ้น
    const timeDiff = Math.max(0, (serverNow - state.lastUpdate) / 1000);
    const targetTime = state.isPlaying
      ? state.timestamp + timeDiff
      : state.timestamp;

    // ถ้าเป็นวิดีโอใหม่
    if (state.videoId !== currentVideoId) {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Video load timeout"));
        }, 10000);

        const onLoadSuccess = (event) => {
          if (
            event.data === YT.PlayerState.PLAYING ||
            event.data === YT.PlayerState.PAUSED
          ) {
            clearTimeout(timeoutId);
            player.removeEventListener("onStateChange", onLoadSuccess);
            resolve();
          }
        };

        player.addEventListener("onStateChange", onLoadSuccess);

        player.loadVideoById({
          videoId: state.videoId,
          startSeconds: targetTime,
        });
      });

      await updateNowPlaying(state.videoId);
    } else {
      // ซิงค์เวลาอย่างอัตโนมัติถ้าแตกต่างกันมากกว่า SYNC_THRESHOLD วินาที
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - targetTime) > SYNC_THRESHOLD) {
        player.seekTo(targetTime, true);
      }
    }

    // ซิงค์สถานะการเล่น
    if (state.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      await player.playVideo();
    } else if (
      !state.isPlaying &&
      player.getPlayerState() === YT.PlayerState.PLAYING
    ) {
      await player.pauseVideo();
    }
  } catch (error) {
    console.error("Error syncing playback state:", error);
    throw error;
  }
}

function handleVideoEnded(socket) {
  if (!socket || isProcessingStateUpdate) return;

  console.log("Processing video ended event");
  isProcessingStateUpdate = true;
  
  // ดึงข้อมูลวิดีโอปัจจุบัน
  const currentVideoId = player?.getVideoData()?.video_id;
  
  // แจ้งเตือน server ว่าวิดีโอจบแล้ว
  socket.emit("videoEnded", { 
    videoId: currentVideoId,
    timestamp: Date.now()
  }, (acknowledgeData) => {
    console.log("Server acknowledged video ended event:", acknowledgeData);
    
    // รอ server จัดการกับคิวและเริ่มเพลงถัดไป
    setTimeout(() => {
      // ขอข้อมูลล่าสุดจาก server
      socket.emit("requestInitialQueue", null, async (response) => {
        if (response?.currentPlaybackState?.videoId) {
          const serverTime = getServerTime();
          await handlePlaybackStateUpdate(
            response.currentPlaybackState,
            serverTime
          );
          lastKnownState = response.currentPlaybackState;
        }
        isProcessingStateUpdate = false;
      });
    }, 500);
  });
}

function startStateSync(socket) {
  let syncInterval;
  const SYNC_CHECK_INTERVAL = 5000; // เพิ่มความถี่การซิงค์เป็นทุก 5 วินาที
  const MAX_RETRY_COUNT = 3;
  let retryCount = 0;

  function scheduleNextSync(delay = SYNC_CHECK_INTERVAL) {
    if (syncInterval) {
      clearInterval(syncInterval);
    }

    syncInterval = setInterval(() => {
      if (
        !isProcessingStateUpdate &&
        isPlayerReady() &&
        !document.hidden &&
        !isUserInteracting
      ) {
        // ขอข้อมูลสถานะจาก server ใหม่ทุกช่วงเวลา แต่เพิ่มเงื่อนไขการตรวจสอบ
        if (initialSyncCompleted && !waitForInitialSync) {
          socket.emit("requestInitialQueue", null, async (response) => {
            if (response?.currentPlaybackState) {
              // ตรวจสอบว่า state เปลี่ยนไปจากที่รู้หรือไม่
              if (
                !lastKnownState ||
                response.currentPlaybackState.lastUpdate > lastKnownState.lastUpdate ||
                response.currentPlaybackState.videoId !== lastKnownState.videoId
              ) {
                const serverTime = getServerTime();
                await handlePlaybackStateUpdate(
                  response.currentPlaybackState,
                  serverTime
                );
                lastKnownState = response.currentPlaybackState;
              }
            }
          });
        } else {
          // ถ้ายังไม่ได้ซิงค์ครั้งแรก ให้ขอสถานะเริ่มต้นแทน
          socket.emit("requestInitialQueue");
        }
      }
    }, delay);
  }

  // Start initial sync
  scheduleNextSync();

  // Cleanup on window unload
  window.addEventListener("beforeunload", () => {
    if (syncInterval) {
      clearInterval(syncInterval);
    }
  });
}

function broadcastCurrentState(socket) {
  if (!isProcessingStateUpdate && isPlayerReady()) {
    // ตรวจสอบว่า client นี้ได้รับการซิงค์จาก server แล้วหรือยัง
    if (waitForInitialSync || !initialSyncCompleted) {
      console.log('Skipping state broadcast - waiting for initial sync');
      return;
    }
    
    // ตรวจสอบว่า client เพิ่งเชื่อมต่อหรือไม่
    const timeConnected = Date.now() - clientJoinTime;
    if (timeConnected < 3000) { // น้อยกว่า 3 วินาที
      console.log('Skipping state broadcast - client just connected');
      return;
    }
    
    const currentState = {
      videoId: player.getVideoData()?.video_id,
      timestamp: player.getCurrentTime(),
      isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      lastUpdate: getServerTime(),
    };
    
    // ตรวจสอบกรณีที่ client อาจจะรีเซ็ต timestamp
    const resetAttempt = lastKnownState && 
                       lastKnownState.videoId === currentState.videoId && 
                       lastKnownState.timestamp > 10 && 
                       currentState.timestamp < 3;
                       
    if (resetAttempt) {
      console.log('Preventing timestamp reset attempt');
      socket.emit('requestInitialQueue'); // ขอ state ใหม่จาก server แทน
      return;
    }
    
    lastKnownState = currentState;
    socket.emit("updatePlaybackState", currentState);
  }
}

function updateDurationDisplay(duration) {
  const durationElement = document.getElementById("videoDuration");
  if (durationElement) {
    durationElement.textContent = duration;
  }
}

async function updateNowPlaying(videoId) {
  const nowPlayingElement = document.getElementById("nowPlaying");
  if (!nowPlayingElement) return;

  if (!videoId) {
    nowPlayingElement.textContent = "ไม่มีเพลง";
    return;
  }

  try {
    const videoDetails = await fetchVideoDetails(videoId);
    nowPlayingElement.textContent = videoDetails.title;
  } catch (error) {
    console.error("Error updating now playing:", error);
    nowPlayingElement.textContent = "ไม่สามารถโหลดชื่อเพลงได้";
  }
}

window.addEventListener("beforeunload", () => {
  if (syncInterval) clearInterval(syncInterval);
});