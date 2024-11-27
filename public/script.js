const socket = io();
let player;
let currentPlayingIndex = -1;
let isSongPlaying = false;
let isInitialSync = true;
let songQueue = [];
let isProcessingStateUpdate = false;
let lastKnownState = null;
let lastStateUpdate = Date.now();
let syncInterval;

function showPlaylistModal(videos, originalVideo) {
  const modalHtml = `
    <div class="modal fade" id="playlistModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title">พบ Playlist</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p>คุณต้องการเพิ่มเพลงจาก playlist นี้อย่างไร?</p>
            <p class="text-muted small">หมายเหตุ: การเพิ่มทุกเพลงจะเริ่มจากเพลงที่คุณเลือก และเพิ่มเพลงที่เหลือตามลำดับใน playlist</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="btn btn-primary" id="addFirstVideo">เพิ่มเพลงที่เลือกมา</button>
            <button type="button" class="btn btn-success" id="addAllVideos">
              เพิ่มทุกเพลง (${videos.length} เพลง)
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // เพิ่ม modal เข้าไปใน DOM
  const modalWrapper = document.createElement('div');
  modalWrapper.innerHTML = modalHtml;
  document.body.appendChild(modalWrapper);

  // สร้าง Modal object
  const modal = new bootstrap.Modal(document.getElementById('playlistModal'));

  // เพิ่ม event listeners
  document.getElementById('addFirstVideo').onclick = () => {
    socket.emit('addPlaylistVideos', [originalVideo]);
    modal.hide();
    modalWrapper.remove();
  };

  document.getElementById('addAllVideos').onclick = () => {
    socket.emit('addPlaylistVideos', videos);
    modal.hide();
    modalWrapper.remove();
  };

  // แสดง modal
  modal.show();
}

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '480px',
    width: '100%',
    videoId: '',
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange
    },
    playerVars: {
      'controls': 1,
      'rel': 0
    }
  });
}

function broadcastCurrentState() {
  if (!isProcessingStateUpdate && player && player.getCurrentTime) {
    const state = {
      videoId: player.getVideoData()?.video_id,
      timestamp: player.getCurrentTime(),
      isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING
    };
    lastKnownState = state;
    socket.emit('updatePlaybackState', state);
  }
}
// Sync state every 1 seconds if playing
function startStateSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    if (player?.getPlayerState() === YT.PlayerState.PLAYING) {
      broadcastCurrentState();
    }
  }, 1000);
}

function onPlayerStateChange(event) {
  if (isProcessingStateUpdate) return;

  if (!isInitialSync) {
    switch(event.data) {
      case YT.PlayerState.PLAYING:
      case YT.PlayerState.PAUSED:
        broadcastCurrentState();
        break;
      
      case YT.PlayerState.ENDED:
        handleVideoEnded();
        break;
    }
  }
}

function clearQueue() {
  const queueContainer = document.getElementById('queue');
  const queueItems = queueContainer.querySelectorAll('.list-group-item');

  // ถ้ามีเพลงในคิวมากกว่า 1 เพลง (นับรวมเพลงที่กำลังเล่น)
  if (queueItems.length > 0) {
    // เพิ่ม animation fade-out ให้กับทุกเพลงในคิว
    queueItems.forEach((item) => {
      item.classList.add('fade-out');
    });

    // รอให้ animation เสร็จสิ้นก่อนส่ง event ไปยัง server
    setTimeout(() => {
      socket.emit('clearQueue');
    }, 300);
  }
}

function playSongFromQueue(index) {
  socket.emit('playSongFromQueue', index);
}

// เพิ่มฟังก์ชันติดตามการเปลี่ยนแปลง timestamp
setInterval(() => {
  if (!isProcessingStateUpdate && player && player.getPlayerState() === YT.PlayerState.PAUSED) {
    const currentTime = player.getCurrentTime();
    if (lastKnownState && Math.abs(lastKnownState.timestamp - currentTime) > 0.5) {
      const state = {
        videoId: player.getVideoData().video_id,
        timestamp: currentTime,
        isPlaying: false
      };
      lastKnownState = state;
      socket.emit('updatePlaybackState', state);
    }
  }
}, 200);

function fetchVideoDetails(videoId, onSuccess, onError) {
  fetch(`/youtube-info/${videoId}`)
    .then(response => response.json())
    .then(onSuccess)
    .catch(onError);
}

async function onPlayerReady(event) {
  try {
    const response = await fetch('/current-state');
    const { currentPlaybackState, songQueue: initialQueue } = await response.json();
    
    if (currentPlaybackState.videoId) {
      const currentTime = Date.now();
      const timeDiff = (currentTime - currentPlaybackState.lastUpdate) / 1000;
      
      isProcessingStateUpdate = true;
      await new Promise((resolve) => {
        player.loadVideoById({
          videoId: currentPlaybackState.videoId,
          startSeconds: currentPlaybackState.timestamp + (currentPlaybackState.isPlaying ? timeDiff : 0)
        });
        
        const checkState = setInterval(() => {
          if (player.getPlayerState() !== YT.PlayerState.BUFFERING) {
            clearInterval(checkState);
            if (currentPlaybackState.isPlaying) {
              player.playVideo();
            } else {
              player.pauseVideo();
            }
            isProcessingStateUpdate = false;
            resolve();
          }
        }, 100);
      });
    }
    
    updateQueue(initialQueue);
    isInitialSync = false;
    startStateSync();
  } catch (error) {
    console.error('Error fetching initial state:', error);
  }
}

function handleVideoEnded() {
  if (songQueue.length > 1) {
    socket.emit('skipSong');
  } else {
    // Clear queue and reset state
    socket.emit('skipSong');  // This will trigger server-side queue update
    
    // Don't need to manually update these as they'll be updated via socket events
    songQueue = [];
    const state = {
      videoId: null,
      timestamp: 0,
      isPlaying: false,
      lastUpdate: Date.now()
    };
    lastKnownState = state;
    isSongPlaying = false;
    
    // Update title
    const nowPlayingTitle = document.getElementById('nowPlaying');
    nowPlayingTitle.textContent = 'ไม่มีเพลง';
  }
}


function playNextSong() {
  if (songQueue.length > 0 && player && typeof player.loadVideoById === 'function') {
    const nextSong = songQueue[0];
    const videoId = extractVideoId(nextSong);

    if (!videoId) {
      console.error('Invalid video ID');
      skipSong();
      return;
    }

    const state = {
      videoId: videoId,
      timestamp: 0,
      isPlaying: true
    };

    isProcessingStateUpdate = true;
    player.loadVideoById({
      videoId: videoId,
      startSeconds: 0
    });

    const checkState = setInterval(() => {
      if (player.getPlayerState() !== YT.PlayerState.BUFFERING) {
        clearInterval(checkState);
        socket.emit('updatePlaybackState', state);
        player.playVideo();
        isProcessingStateUpdate = false;
      }
    }, 100);

    isSongPlaying = true;
    currentPlayingIndex = 0;

    fetchVideoDetails(videoId, (videoDetails) => {
      const nowPlayingTitle = document.getElementById('nowPlaying');
      nowPlayingTitle.textContent = `กำลังเล่น: ${videoDetails.title}`;
    });
  } else {
    isSongPlaying = false;
    currentPlayingIndex = -1;
    if (player && typeof player.stopVideo === 'function') {
      player.stopVideo();
    }
    const nowPlayingTitle = document.getElementById('nowPlaying');
    nowPlayingTitle.textContent = 'ไม่มีเพลง';
  }
}

function addSong() {
  const songInput = document.getElementById('songInput');
  const song = songInput.value;
  if (song) {
    socket.emit('addSong', song);
    songInput.value = '';
  }
}

socket.on('playlistFound', ({ videos, originalVideo }) => {
  showPlaylistModal(videos, originalVideo);
});

function skipSong() {
  socket.emit('skipSong');
}

function removeSong(index) {
  const listItem = document.querySelectorAll('.song-item')[index - 1];
  listItem.classList.add('fade-out');

  setTimeout(() => {
    socket.emit('removeSong', index);
  }, 300);
}

function moveSong(fromIndex, toIndex) {
  const songItems = document.querySelectorAll('.song-item');
  const movingItem = songItems[fromIndex - 1];

  const direction = toIndex < fromIndex ? 'move-up' : 'move-down';
  movingItem.classList.add(direction);

  setTimeout(() => {
    movingItem.classList.remove(direction);
    socket.emit('moveSong', fromIndex, toIndex);
  }, 300);
}

function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}

function updateQueue(queue) {
  songQueue = queue;
  const queueList = document.getElementById('queue');
  queueList.innerHTML = '';

  queue.forEach((song, index) => {
    if (index === 0) {
      const videoId = extractVideoId(song);
      fetchVideoDetails(videoId, (videoDetails) => {
        const nowPlayingTitle = document.getElementById('nowPlaying');
        nowPlayingTitle.textContent = `กำลังเล่น: ${videoDetails.title}`;
      });
      return;
    }

    const listItem = document.createElement('div');
    listItem.className = 'list-group-item song-item';

    const videoId = extractVideoId(song);

    const loadingIndicator = document.createElement('div');
    loadingIndicator.textContent = 'กำลังโหลด...';
    loadingIndicator.className = 'spinner-border text-primary';
    listItem.appendChild(loadingIndicator);

    listItem.classList.add('fade-in');
    queueList.appendChild(listItem);

    fetchVideoDetails(
      videoId,
      (videoDetails) => {
        listItem.removeChild(loadingIndicator);

        // เพิ่มปุ่ม Play
        const playButton = document.createElement('button');
        playButton.innerHTML = '▶️';
        playButton.className = 'btn btn-link btn-sm play-button';
        playButton.title = 'เล่นเพลงนี้';
        playButton.onclick = () => playSongFromQueue(index);

        const title = videoDetails.title;
        const thumbnail = videoDetails.thumbnails.default.url;

        const thumbnailImg = document.createElement('img');
        thumbnailImg.src = thumbnail;
        thumbnailImg.alt = title;
        thumbnailImg.className = 'me-3';

        const titleText = document.createElement('span');
        titleText.textContent = title;
        titleText.className = 'd-flex text-white';

        const controlsElement = document.createElement('div');
        controlsElement.className = 'song-controls';

        const upButton = document.createElement('button');
        upButton.textContent = '⬆️';
        upButton.className = 'btn btn-secondary btn-sm ms-2';
        upButton.disabled = index <= 1;
        if (index > 1) {
          upButton.onclick = () => moveSong(index, index - 1);
        }

        const downButton = document.createElement('button');
        downButton.textContent = '⬇️';
        downButton.className = 'btn btn-secondary btn-sm ms-2';
        downButton.disabled = index >= queue.length - 1;
        if (index < queue.length - 1) {
          downButton.onclick = () => moveSong(index, index + 1);
        }

        const removeButton = document.createElement('button');
        removeButton.textContent = '🗑️';
        removeButton.className = 'btn btn-danger btn-sm ms-2';
        removeButton.onclick = () => removeSong(index);

        controlsElement.appendChild(upButton);
        controlsElement.appendChild(downButton);
        controlsElement.appendChild(removeButton);

        listItem.appendChild(playButton);
        listItem.appendChild(thumbnailImg);
        listItem.appendChild(titleText);
        listItem.appendChild(controlsElement);
      },
      (error) => {
        listItem.removeChild(loadingIndicator);
        const errorText = document.createElement('span');
        errorText.textContent = 'ไม่สามารถโหลดข้อมูลวิดีโอได้';
        errorText.className = 'text-danger';
        listItem.appendChild(errorText);
        socket.emit('removeSong', index);
      }
    );
  });
}

function showClearQueueModal() {
  const modalHtml = `
    <div class="modal fade" id="clearQueueModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content bg-dark text-white">
          <div class="modal-header">
            <h5 class="modal-title">ยืนยันการเคลียร์คิว</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p>คุณแน่ใจหรือไม่ที่จะเคลียร์คิวเพลงทั้งหมด?</p>
            <small class="text-muted">เพลงที่กำลังเล่นอยู่จะไม่ถูกลบ</small>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">ยกเลิก</button>
            <button type="button" class="btn btn-danger" id="confirmClearQueue">ยืนยันการเคลียร์</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // เพิ่ม modal เข้าไปใน DOM
  const modalWrapper = document.createElement('div');
  modalWrapper.innerHTML = modalHtml;
  document.body.appendChild(modalWrapper);

  // สร้าง Modal object
  const modal = new bootstrap.Modal(document.getElementById('clearQueueModal'));

  // เพิ่ม event listener สำหรับปุ่มยืนยัน
  document.getElementById('confirmClearQueue').onclick = () => {
    const queueContainer = document.getElementById('queue');
    const queueItems = queueContainer.querySelectorAll('.list-group-item');

    if (queueItems.length > 0) {
      queueItems.forEach((item) => {
        item.classList.add('fade-out');
      });

      setTimeout(() => {
        socket.emit('clearQueue');
      }, 300);
    }

    modal.hide();
    modalWrapper.remove();
  };

  // เพิ่ม event listener สำหรับการลบ modal เมื่อถูกปิด
  document.getElementById('clearQueueModal').addEventListener('hidden.bs.modal', () => {
    modalWrapper.remove();
  });

  // แสดง modal
  modal.show();
}

socket.on('connect', () => {
  console.log('Connected to server');
  document.getElementById('addSongButton').addEventListener('click', addSong);
  document.getElementById('clearQueueBtn').addEventListener('click', showClearQueueModal);

  // เพิ่ม event listener สำหรับการกด Enter ที่ช่อง input
  document.getElementById('songInput').addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      addSong();
    }
  });
});

socket.on('initialState', ({ songQueue: initialQueue, currentPlaybackState }) => {
  if (currentPlaybackState.videoId && player && player.loadVideoById) {
    isProcessingStateUpdate = true;
    
    const currentTime = Date.now();
    const timeDiff = (currentTime - currentPlaybackState.lastUpdate) / 1000;
    
    player.loadVideoById({
      videoId: currentPlaybackState.videoId,
      startSeconds: currentPlaybackState.timestamp + timeDiff
    });

    // รอให้วิดีโอโหลดเสร็จก่อนเล่น
    const checkState = setInterval(() => {
      const playerState = player.getPlayerState();
      if (playerState !== YT.PlayerState.BUFFERING && playerState !== -1) {
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
  
  updateQueue(initialQueue);
});

socket.on('playbackState', (state) => {
  if (!player || !player.loadVideoById) return;
  
  const currentTime = Date.now();
  // Ignore old state updates
  if (state.lastUpdate < lastStateUpdate) return;
  lastStateUpdate = state.lastUpdate;
  
  isProcessingStateUpdate = true;
  lastKnownState = state;
  
  const timeDiff = (currentTime - state.lastUpdate) / 1000;
  const currentVideoId = player.getVideoData()?.video_id;

  const handlePlayback = () => {
    const actualTimeDiff = (Date.now() - state.lastUpdate) / 1000;
    const targetTime = state.timestamp + (state.isPlaying ? actualTimeDiff : 0);
    
    const currentTime = player.getCurrentTime();
    const timeDifference = Math.abs(currentTime - targetTime);
    
    // Only seek if the difference is significant
    if (timeDifference > 2) {
      player.seekTo(targetTime, true);
    }

    if (state.isPlaying) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
  };

  if (state.videoId !== currentVideoId) {
    player.loadVideoById({
      videoId: state.videoId,
      startSeconds: state.timestamp + (state.isPlaying ? timeDiff : 0)
    });

    const checkState = setInterval(() => {
      const playerState = player.getPlayerState();
      if (playerState !== YT.PlayerState.BUFFERING && playerState !== -1) {
        clearInterval(checkState);
        handlePlayback();
        setTimeout(() => {
          isProcessingStateUpdate = false;
        }, 500);
      }
    }, 100);
  } else {
    handlePlayback();
    setTimeout(() => {
      isProcessingStateUpdate = false;
    }, 500);
  }
});

// ปรับปรุงการจัดการเมื่อเพิ่มเพลงใหม่
socket.on('queueUpdated', (queue) => {
  updateQueue(queue);
  
  // ตรวจสอบว่าไม่มีเพลงเล่นอยู่ และมีเพลงในคิว
  if ((!lastKnownState?.videoId || !lastKnownState?.isPlaying) && queue.length > 0) {
    const videoId = extractVideoId(queue[0]);
    if (videoId) {
      const state = {
        videoId: videoId,
        timestamp: 0,
        isPlaying: true,
        lastUpdate: Date.now()
      };
      lastKnownState = state;
      isSongPlaying = true;
      
      // โหลดและเล่นวิดีโอใหม่
      if (player && player.loadVideoById) {
        isProcessingStateUpdate = true;
        player.loadVideoById({
          videoId: videoId,
          startSeconds: 0
        });
        
        // รอให้วิดีโอโหลดเสร็จก่อนเล่น
        const checkState = setInterval(() => {
          if (player.getPlayerState() !== YT.PlayerState.BUFFERING) {
            clearInterval(checkState);
            player.playVideo();
            socket.emit('updatePlaybackState', state);
            isProcessingStateUpdate = false;
          }
        }, 100);
      }
    }
  }
});

// เพิ่ม error handler สำหรับ socket connection
socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('connect_timeout', (timeout) => {
  console.error('Socket connection timeout:', timeout);
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (syncInterval) clearInterval(syncInterval);
});