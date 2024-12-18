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
let timeOffset = 0; // ค่าความต่างระหว่างเวลา server และ client


function emitWithRetry(eventName, data, maxRetries = 3) {
  let retries = 0;

  function tryEmit() {
    socket.emit(eventName, data, (ack) => {
      if (!ack && retries < maxRetries) {
        retries++;
        setTimeout(tryEmit, 1000 * retries); // exponential backoff
      }
    });
  }

  tryEmit();
}

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

// ฟังก์ชันสำหรับซิงค์เวลากับ server
async function syncWithServer() {
  const startTime = Date.now();
  try {
    const response = await fetch('/server-time');
    const { serverTime } = await response.json();
    const endTime = Date.now();
    const networkDelay = (endTime - startTime) / 2;

    // คำนวณความต่างของเวลา โดยหักลบ network latency
    timeOffset = serverTime - (startTime + networkDelay);

    // ทำการซิงค์ซ้ำทุก 5 นาที
    setTimeout(syncWithServer, 5 * 60 * 1000);
  } catch (error) {
    console.error('Time sync failed:', error);
    // ลองซิงค์ใหม่ใน 10 วินาที ถ้าเกิดข้อผิดพลาด
    setTimeout(syncWithServer, 10000);
  }
}

// ฟังก์ชันสำหรับรับค่าเวลาปัจจุบันของ server
function getServerTime() {
  return Date.now() + timeOffset;
}

function broadcastCurrentState() {
  if (!isProcessingStateUpdate && player && player.getCurrentTime) {
    const currentState = {
      videoId: player.getVideoData()?.video_id,
      timestamp: player.getCurrentTime(),
      isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING,
      lastUpdate: getServerTime() // ใช้เวลา server แทน Date.now()
    };
    lastKnownState = currentState;
    socket.emit('updatePlaybackState', currentState);
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
      const serverTime = getServerTime();
      const timeDiff = (serverTime - currentPlaybackState.lastUpdate) / 1000;
      const startSeconds = currentPlaybackState.timestamp + (currentPlaybackState.isPlaying ? timeDiff : 0);

      isProcessingStateUpdate = true;

      player.loadVideoById({
        videoId: currentPlaybackState.videoId,
        startSeconds: startSeconds
      });

      const checkState = setInterval(() => {
        if (player.getPlayerState() === YT.PlayerState.PLAYING || YT.PlayerState.PAUSED) {
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
    isInitialSync = false;
    startStateSync();
  } catch (error) {
    console.error('Error fetching initial state:', error);
  }
}

function handleVideoEnded() {
  if (songQueue.length > 0) {
    // เมื่อเพลงจบ ให้เล่นเพลงแรกในคิว
    emitWithRetry('skipSong');// ให้ server จัดการคิวและส่ง state กลับมา
  } else {
    // ถ้าไม่มีเพลงในคิว รีเซ็ตสถานะ
    const state = {
      videoId: null,
      timestamp: 0,
      isPlaying: false,
      lastUpdate: Date.now()
    };
    emitWithRetry('updatePlaybackState', state);

    // อัพเดทชื่อเพลง
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

        // สร้างปุ่ม Play พร้อม tooltip
        const playButtonContainer = document.createElement('div');
        playButtonContainer.className = 'play-button-container';

        const playButton = document.createElement('button');
        playButton.innerHTML = '▶️';
        playButton.className = 'btn btn-link btn-sm play-button';
        playButton.title = 'เล่นเพลงนี้ทันที';
        playButton.onclick = () => {
          // เพิ่ม animation เมื่อคลิก
          playButton.classList.add('play-button-clicked');
          setTimeout(() => {
            playButton.classList.remove('play-button-clicked');
            playSongFromQueue(index);
          }, 200);
        };

        playButtonContainer.appendChild(playButton);

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

        listItem.appendChild(playButtonContainer);
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

  const serverNow = getServerTime();
  // ไม่รับ state ที่เก่ากว่า state ปัจจุบัน
  if (state.lastUpdate < lastStateUpdate) return;
  lastStateUpdate = state.lastUpdate;

  isProcessingStateUpdate = true;
  lastKnownState = state;

  const timeDiff = (serverNow - state.lastUpdate) / 1000;
  const currentVideoId = player.getVideoData()?.video_id;

  const handlePlayback = () => {
    const targetTime = state.isPlaying ?
      state.timestamp + ((getServerTime() - state.lastUpdate) / 1000) :
      state.timestamp;

    const currentTime = player.getCurrentTime();
    const timeDifference = Math.abs(currentTime - targetTime);

    // ปรับ timestamp ถ้ามีความต่างมากกว่า 0.5 วินาที
    if (timeDifference > 0.5) {
      player.seekTo(targetTime, true);
    }

    if (state.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      player.playVideo();
    } else if (!state.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
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


// ปรับปรุงฟังก์ชัน showSearchResults
function showSearchResults(results, message) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) {
    console.error('Chat messages container not found');
    return;
  }

  // ลบผลการค้นหาเก่า
  const oldResults = chatMessages.querySelectorAll('.search-results');
  oldResults.forEach(element => element.remove());

  // แสดงข้อความจาก AI
  if (message) {
    addMessageToChat('assistant', message);
  }

  // สร้าง container สำหรับผลการค้นหา
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'search-results fade-in';

  results.forEach(result => {
    const resultItem = document.createElement('div');
    resultItem.className = 'search-result-item';

    // สร้าง thumbnail container
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'thumbnail-container';

    const thumbnail = document.createElement('img');
    thumbnail.src = result.thumbnail;
    thumbnail.alt = result.title;
    thumbnail.className = 'search-result-thumbnail';
    thumbnail.style.width = '100%';
    thumbnail.style.height = '100%';
    thumbnail.style.objectFit = 'cover';

    thumbnailContainer.appendChild(thumbnail);

    // สร้าง info container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'search-result-info';

    const title = document.createElement('div');
    title.className = 'search-result-title';
    title.textContent = result.title;

    const channel = document.createElement('div');
    channel.className = 'search-result-channel';
    channel.textContent = result.channel;

    infoContainer.appendChild(title);
    infoContainer.appendChild(channel);

    // สร้างปุ่ม Add to Queue
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-sm btn-primary add-to-queue-btn';
    addButton.textContent = 'Add song';

    addButton.onclick = () => {
      addButton.disabled = true;
      addButton.classList.add('loading');
      addButton.textContent = 'Adding...';

      const videoUrl = `https://www.youtube.com/watch?v=${result.id}`;
      socket.emit('addSong', videoUrl);

      setTimeout(() => {
        addButton.classList.remove('loading');
        addButton.classList.add('success');
        addButton.textContent = 'Added!';

        setTimeout(() => {
          addButton.classList.remove('success');
          addButton.disabled = false;
          addButton.textContent = 'Add song';
        }, 2000);
      }, 500);
    };

    resultItem.appendChild(thumbnailContainer);
    resultItem.appendChild(infoContainer);
    resultItem.appendChild(addButton);

    resultsContainer.appendChild(resultItem);
  });

  chatMessages.appendChild(resultsContainer);

  // เลื่อนไปที่ผลการค้นหาล่าสุด
  setTimeout(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 100);
}


function addMessageToChat(role, message) {
  const chatMessages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}-message`;
  messageDiv.textContent = message;

  // Animation
  messageDiv.style.opacity = '0';
  chatMessages.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.style.opacity = '1';
    messageDiv.style.transition = 'opacity 0.3s ease-in-out';
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 100);
}

function initializeChatInterface() {
  const chatMessages = document.getElementById('chatMessages');
  const chatInputContainer = document.querySelector('.chat-input-container');

  if (!chatMessages || !chatInputContainer) {
    console.error('Chat interface elements not found');
    return;
  }

  // สร้าง UI elements
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = 'พิมพ์เพื่อค้นหาเพลง สั่งเล่น หรือถามเกี่ยวกับเพลง...';

  const sendButton = document.createElement('button');
  sendButton.className = 'chat-submit';
  sendButton.innerHTML = '➤';

  // ล้าง container ก่อนเพิ่ม elements ใหม่
  chatInputContainer.innerHTML = '';
  chatInputContainer.appendChild(input);
  chatInputContainer.appendChild(sendButton);

  // ฟังก์ชันส่งข้อความ
  function sendMessage() {
    const message = input.value.trim();
    if (message) {
      addMessageToChat('user', message);
      socket.emit('chat message', message);
      input.value = '';
    }
  }

  // Event listeners
  sendButton.onclick = sendMessage;
  input.onkeypress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  // แสดงข้อความต้อนรับ
  setTimeout(() => {
    addMessageToChat('assistant', 'สวัสดีครับ! ผมสามารถช่วยคุณค้นหาเพลง ควบคุมการเล่น และตอบคำถามเกี่ยวกับเพลงได้');
  }, 1000);
}


// รับการตอบกลับจาก server
socket.on('chat response', ({ message, isCommand }) => {
  // แยกข้อความคำสั่งออกจากข้อความที่จะแสดง
  const displayMessage = message.replace(/\[COMMAND:\w+(?::\d+)?\]/g, '').trim();
  const commandMatch = message.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);

  if (!isCommand && displayMessage) {
    addMessageToChat('assistant', displayMessage);
  }

  if (commandMatch) {
    const command = commandMatch[1];
    switch (command) {
      case 'skip':
        skipSong();
        break;
      case 'pause':
        player.pauseVideo();
        break;
      case 'play':
        player.playVideo();
        break;
      case 'clear':
        clearQueue();
        break;
      // เพิ่มคำสั่งอื่นๆ ตามต้องการ
    }
  }
});



// เริ่มต้น chat interface เมื่อโหลดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
  syncWithServer();
  // Initial setup
  initializeChatInterface();

  // Clear old event listeners
  socket.off('search results');
  socket.off('chat response');

  // Register new event listeners
  socket.on('search results', ({ results, message }) => {
    console.log('Received search results:', results);
    showSearchResults(results, message);
  });

  socket.on('chat response', ({ message, isCommand }) => {
    const displayMessage = message.replace(/\[COMMAND:\w+(?::\d+)?\]/g, '').trim();
    const commandMatch = message.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);

    if (!isCommand && displayMessage) {
      addMessageToChat('assistant', displayMessage);
    }

    if (commandMatch) {
      const command = commandMatch[1];
      switch (command) {
        case 'skip':
          skipSong();
          break;
        case 'pause':
          if (player && player.pauseVideo) player.pauseVideo();
          break;
        case 'play':
          if (player && player.playVideo) player.playVideo();
          break;
        case 'clear':
          clearQueue();
          break;
      }
    }
  });
});