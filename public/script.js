const socket = io();
let player;
let currentPlayingIndex = -1;
let isSongPlaying = false;
let isInitialSync = true;
let songQueue = [];
let isProcessingStateUpdate = false;

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

      player.loadVideoById({
        videoId: currentPlaybackState.videoId,
        startSeconds: currentPlaybackState.timestamp + timeDiff
      });

      if (currentPlaybackState.isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    }

    updateQueue(initialQueue);
    isInitialSync = false;
  } catch (error) {
    console.error('Error fetching initial state:', error);
  }
}

function onPlayerStateChange(event) {
  if (isProcessingStateUpdate) return;

  if (!isInitialSync) {
    switch (event.data) {
      case YT.PlayerState.PLAYING:
      case YT.PlayerState.PAUSED:
        const state = {
          videoId: player.getVideoData().video_id,
          timestamp: player.getCurrentTime(),
          isPlaying: event.data === YT.PlayerState.PLAYING
        };
        socket.emit('updatePlaybackState', state);
        break;

      case YT.PlayerState.ENDED:
        handleVideoEnded();
        break;
    }
  }
}

function handleVideoEnded() {
  if (songQueue.length > 1) {
    socket.emit('skipSong');
  } else {
    const state = {
      videoId: player.getVideoData().video_id,
      timestamp: 0,
      isPlaying: false
    };
    socket.emit('updatePlaybackState', state);
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
    socket.emit('updatePlaybackState', state);

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

socket.on('connect', () => {
  console.log('Connected to server');
  document.getElementById('addSongButton').addEventListener('click', addSong);

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

    if (currentPlaybackState.isPlaying) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }

    setTimeout(() => {
      isProcessingStateUpdate = false;
    }, 500);
  }

  updateQueue(initialQueue);
});

socket.on('playbackState', (state) => {
  if (!player || !player.loadVideoById) return;

  isProcessingStateUpdate = true;

  const currentTime = Date.now();
  const timeDiff = (currentTime - state.lastUpdate) / 1000;

  if (state.videoId !== player.getVideoData()?.video_id) {
    player.loadVideoById({
      videoId: state.videoId,
      startSeconds: state.timestamp + timeDiff
    });
  } else {
    const currentPlayerTime = player.getCurrentTime();
    const expectedTime = state.timestamp + timeDiff;

    if (Math.abs(currentPlayerTime - expectedTime) > 2) {
      player.seekTo(expectedTime, true);
    }

    if (state.isPlaying && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      player.playVideo();
    } else if (!state.isPlaying && player.getPlayerState() === YT.PlayerState.PLAYING) {
      player.pauseVideo();
    }
  }

  setTimeout(() => {
    isProcessingStateUpdate = false;
  }, 500);
});

socket.on('queueUpdated', updateQueue);

// เพิ่ม error handler สำหรับ socket connection
socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error);
});

socket.on('connect_timeout', (timeout) => {
  console.error('Socket connection timeout:', timeout);
});