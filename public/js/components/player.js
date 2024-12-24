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
const INTERACTION_TIMEOUT = 3000;
let userSeekTimeout = null;
const SYNC_INTERVAL = 1000;
const SEEK_DELAY = 500;

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
      // เมื่อเปิดหน้าต่างขึ้นมา ขอข้อมูลล่าสุดจาก server แต่ไม่ย้อนกลับไปเล่นเพลงเดิม
      const currentVideoId = player.getVideoData()?.video_id;
      socket.emit("requestInitialQueue", null, async (response) => {
        if (response?.currentPlaybackState) {
          // ตรวจสอบว่าเพลงปัจจุบันยังเป็นเพลงเดียวกันหรือไม่
          if (response.currentPlaybackState.videoId === currentVideoId) {
            // ถ้าเป็นเพลงเดียวกัน อัพเดทเฉพาะสถานะการเล่น
            if (
              response.currentPlaybackState.isPlaying !== wasPlayingBeforeHidden
            ) {
              if (response.currentPlaybackState.isPlaying) {
                player.playVideo();
              } else {
                player.pauseVideo();
              }
            }
          } else {
            // ถ้าเป็นเพลงใหม่ โหลดเพลงใหม่
            const serverTime = getServerTime();
            await handlePlaybackStateUpdate(
              response.currentPlaybackState,
              serverTime
            );
          }
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

// เพิ่มฟังก์ชันใหม่สำหรับจัดการ player error
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

      player.loadVideoById({
        videoId: currentPlaybackState.videoId,
        startSeconds: startSeconds,
      });

      await updateNowPlaying(currentPlaybackState.videoId);
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
    case YT.PlayerState.PAUSED:
      if (!document.hidden) {
        broadcastCurrentState(socket);
      }
      break;
    case YT.PlayerState.ENDED:
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
  socket.on("playbackState", async (state) => {
    if (!player || !player.loadVideoById) return;
    if (state.lastUpdate <= (lastKnownState?.lastUpdate || 0)) return;

    isProcessingStateUpdate = true;
    try {
      const serverNow = getServerTime();
      await handlePlaybackStateUpdate(state, serverNow);
      lastKnownState = state;
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
      // ซิงค์เวลาถ้าแตกต่างกันมากกว่า 2 วินาที
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - targetTime) > 2) {
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

  isProcessingStateUpdate = true;
  updateNowPlaying(null);

  // แจ้ง server ว่าวิดีโอจบและรอการตอบกลับ
  socket.emit("videoEnded", null, async () => {
    // รอให้ server ประมวลผลเสร็จก่อนขอข้อมูลใหม่
    setTimeout(() => {
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
    }, 500); // รอ 500ms เพื่อให้แน่ใจว่า server ประมวลผลเสร็จ
  });
}

function startStateSync(socket) {
  let syncInterval;
  const SYNC_CHECK_INTERVAL = 1000;
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
        player?.getPlayerState() === YT.PlayerState.PLAYING &&
        !document.hidden
      ) {
        const currentState = {
          videoId: player.getVideoData()?.video_id,
          timestamp: player.getCurrentTime(),
          isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
          lastUpdate: getServerTime(),
        };

        // Only emit if significant change
        if (shouldEmitStateUpdate(currentState, lastKnownState)) {
          socket.emit(
            "updatePlaybackState",
            currentState,
            (acknowledgement) => {
              if (!acknowledgement && retryCount < MAX_RETRY_COUNT) {
                retryCount++;
                // Exponential backoff for retries
                const backoffDelay = Math.min(
                  1000 * Math.pow(2, retryCount),
                  5000
                );
                scheduleNextSync(backoffDelay);
              } else {
                retryCount = 0;
              }
            }
          );
          lastKnownState = currentState;
        }
      }
    }, delay);
  }

  function shouldEmitStateUpdate(newState, oldState) {
    if (!oldState) return true;

    const timeDiff = Math.abs(newState.timestamp - oldState.timestamp);
    const isStateChanged =
      newState.isPlaying !== oldState.isPlaying ||
      newState.videoId !== oldState.videoId;

    return timeDiff > 1 || isStateChanged;
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
    const currentState = {
      videoId: player.getVideoData()?.video_id,
      timestamp: player.getCurrentTime(),
      isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      lastUpdate: getServerTime(),
    };
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
});;
