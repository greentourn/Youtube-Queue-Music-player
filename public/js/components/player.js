// components/player.js
import { getServerTime } from '../services/uiService.js';
import { fetchVideoDetails } from '../services/youtubeService.js';
import { debounce, formatDuration, handleAsyncOperation } from '../utils/helpers.js';

let player;
let isProcessingStateUpdate = false;
let lastKnownState = null;
let syncInterval;
let isInitialSync = true;
let isUserInteracting = false;
let userInteractionTimeout;
const INTERACTION_TIMEOUT = 3000;

export function initializePlayer(socket) {
    if (window.YT && window.YT.Player) {
        console.log('YouTube API is already ready');
        createPlayer(socket);
    } else {
        console.log('Waiting for YouTube API...');
        window.onYouTubeIframeAPIReady = () => {
            console.log('YouTube API is now ready');
            createPlayer(socket);
        };
    }

    setupSocketListeners(socket);
    startStateSync(socket);
}

function createPlayer(socket) {
    console.log('Creating YouTube player...');
    const playerContainer = document.getElementById('player');
    if (!playerContainer) {
        console.error('Player container not found!');
        return;
    }

    try {
        player = new YT.Player('player', {
            height: '480',
            width: '100%',
            videoId: '',
            events: {
                onReady: () => {
                    console.log('Player is ready');
                    onPlayerReady(socket);
                },
                onStateChange: (event) => onPlayerStateChange(event, socket),
                onError: (error) => console.error('YouTube Player Error:', error)
            },
            playerVars: {
                controls: 1,
                rel: 0,
                fs: 1,
                modestbranding: 1,
                playsinline: 1
            }
        });
        window.player = player;
        setupPlayerListeners(socket);
    } catch (error) {
        console.error('Error creating YouTube player:', error);
    }
}

function onPlayerReady(socket) {
    if (socket) {
        socket.emit('requestInitialQueue');
    }
    initializePlayerState(socket);
}

async function initializePlayerState(socket) {
    try {
        const { currentPlaybackState, songQueue } = await handleAsyncOperation(
            fetch('/current-state'),
            {
                loadingMessage: 'กำลังโหลดสถานะเริ่มต้น...',
                errorMessage: 'ไม่สามารถโหลดสถานะเริ่มต้นได้'
            }
        );

        if (currentPlaybackState.videoId) {
            const serverTime = getServerTime();
            const timeDiff = (serverTime - currentPlaybackState.lastUpdate) / 1000;
            const startSeconds = currentPlaybackState.timestamp +
                (currentPlaybackState.isPlaying ? timeDiff : 0);

            isProcessingStateUpdate = true;
            player.loadVideoById({
                videoId: currentPlaybackState.videoId,
                startSeconds: startSeconds
            });

            const duration = formatDuration(player.getDuration());
            updateDurationDisplay(duration);

            const checkState = setInterval(() => {
                if (player.getPlayerState() !== YT.PlayerState.BUFFERING) {
                    clearInterval(checkState);
                    if (currentPlaybackState.isPlaying) {
                        player.playVideo();
                    } else {
                        player.pauseVideo();
                    }
                    isProcessingStateUpdate = false;
                }
            }, 100);
        }
        isInitialSync = false;
    } catch (error) {
        console.error('Error fetching initial state:', error);
    }
}

function onPlayerStateChange(event, socket) {
    if (isProcessingStateUpdate) return;

    if (!isInitialSync) {
        switch (event.data) {
            case YT.PlayerState.PLAYING:
            case YT.PlayerState.PAUSED:
                if (!isUserInteracting) {
                    debouncedBroadcastState(socket);
                }
                break;
            case YT.PlayerState.ENDED:
                handleVideoEnded(socket);
                break;
        }
    }
}

const debouncedBroadcastState = debounce((socket) => {
    if (!isProcessingStateUpdate && player && player.getCurrentTime && !isUserInteracting) {
        const currentState = {
            videoId: player.getVideoData()?.video_id,
            timestamp: player.getCurrentTime(),
            isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
            lastUpdate: getServerTime()
        };
        lastKnownState = currentState;
        socket.emit('updatePlaybackState', currentState);
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
    videoElement.addEventListener('mousedown', () => {
        startUserInteraction();
    });

    document.addEventListener('mouseup', () => {
        if (isUserInteracting) {
            endUserInteraction(socket);
        }
    });
}

function setupSocketListeners(socket) {
    socket.on('playbackState', async (state) => {
        if (!player || !player.loadVideoById) return;
        if (isUserInteracting) return;
        
        const serverNow = getServerTime();
        if (state.lastUpdate < lastKnownState?.lastUpdate) return;

        lastKnownState = state;
        isProcessingStateUpdate = true;

        try {
            await handlePlaybackStateUpdate(state, serverNow);
        } catch (error) {
            console.error('Error handling playback state:', error);
        } finally {
            setTimeout(() => {
                isProcessingStateUpdate = false;
            }, 500);
        }
    });
}

async function handlePlaybackStateUpdate(state, serverNow) {
    const currentVideoId = player.getVideoData()?.video_id;

    if (state.videoId !== currentVideoId) {
        if (state.videoId) {
            try {
                const videoDetails = await fetchVideoDetails(state.videoId);
                const nowPlayingTitle = document.getElementById('nowPlaying');
                if (nowPlayingTitle) {
                    nowPlayingTitle.textContent = `กำลังเล่น: ${videoDetails.title}`;
                }
            } catch (error) {
                console.error('Error fetching video details:', error);
            }
        }

        const startTime = state.isPlaying ?
            state.timestamp + ((serverNow - state.lastUpdate) / 1000) :
            state.timestamp;

        player.loadVideoById({
            videoId: state.videoId,
            startSeconds: startTime
        });
    } else {
        const targetTime = state.isPlaying ?
            state.timestamp + ((serverNow - state.lastUpdate) / 1000) :
            state.timestamp;

        const currentTime = player.getCurrentTime();
        const timeDifference = Math.abs(currentTime - targetTime);

        if (timeDifference > 3) {
            player.seekTo(targetTime, true);
        }

        if (state.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
            player.playVideo();
        } else if (!state.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
            player.pauseVideo();
        }
    }
}

function handleVideoEnded(socket) {
    if (!socket) return;
    console.log('Video ended, emitting skipSong');
    socket.emit('skipSong');
}

function startStateSync(socket) {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (player?.getPlayerState() === YT.PlayerState.PLAYING && !isUserInteracting) {
            broadcastCurrentState(socket);
        }
    }, 1000);
}

function broadcastCurrentState(socket) {
    if (!isProcessingStateUpdate && player && player.getCurrentTime && !isUserInteracting) {
        const currentState = {
            videoId: player.getVideoData()?.video_id,
            timestamp: player.getCurrentTime(),
            isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
            lastUpdate: getServerTime()
        };
        lastKnownState = currentState;
        socket.emit('updatePlaybackState', currentState);
    }
}

function updateDurationDisplay(duration) {
    const durationElement = document.getElementById('videoDuration');
    if (durationElement) {
        durationElement.textContent = duration;
    }
}

window.addEventListener('beforeunload', () => {
    if (syncInterval) clearInterval(syncInterval);
});