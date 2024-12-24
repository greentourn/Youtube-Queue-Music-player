// services/socketService-client.js
let socket = null;

export function initializeSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected to server');
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  socket.on('connect_timeout', (timeout) => {
    console.error('Socket connection timeout:', timeout);
  });

  socket.on('activeUsers', (count) => {
    const activeUsersElement = document.getElementById('activeUsers');
    if (activeUsersElement) {
      activeUsersElement.style.transform = 'scale(1.2)';
      activeUsersElement.textContent = count;
      setTimeout(() => {
        activeUsersElement.style.transform = 'scale(1)';
      }, 200);
    }
  });

  // เพิ่มการจัดการ playbackState event
  socket.on('playbackState', (state) => {
    if (window.player) {
      const currentVideoId = window.player.getVideoData()?.video_id;
      
      // ถ้าเป็นวิดีโอใหม่
      if (state.videoId && state.videoId !== currentVideoId) {
        window.player.loadVideoById({
          videoId: state.videoId,
          startSeconds: state.timestamp
        });
      }
      
      // จัดการสถานะการเล่น
      if (state.isPlaying) {
        window.player.playVideo();
      } else {
        window.player.pauseVideo();
      }
    }
  });

  return socket;
}

export function getSocket() {
  if (!socket) {
    throw new Error('Socket not initialized');
  }
  return socket;
}

export function emitWithRetry(eventName, data, maxRetries = 3) {
  let retries = 0;
  const socket = getSocket();

  function tryEmit() {
    socket.emit(eventName, data, (ack) => {
      if (!ack && retries < maxRetries) {
        retries++;
        setTimeout(tryEmit, 1000 * retries);
      }
    });
  }

  tryEmit();
}