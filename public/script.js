const socket = io();
let player;  // ตัวแปรที่จะเก็บ YouTube player instance
let currentPlayingIndex = -1;
let isSongPlaying = false;
const apiKey = 'AIzaSyB9lB2v1PLpfilw_a5dEqfD-yw3WNhtxE4';

// ฟังก์ชันที่จะถูกเรียกเมื่อ YouTube IFrame Player API พร้อมใช้งาน
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '480px',
    width: '100%',
    videoId: '',  // เริ่มต้นยังไม่มีวิดีโอ
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange
    }
  });
}

function fetchVideoDetails(videoId, callback, errorCallback) {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
  
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        if (data.items && data.items.length > 0) {
          const video = data.items[0].snippet;
          const videoDetails = {
            title: video.title,
            thumbnail: video.thumbnails.default.url
          };
          callback(videoDetails);
        } else {
          throw new Error('Video not found');
        }
      })
      .catch(error => {
        console.error('Error fetching video details:', error);
        errorCallback(error);
      });
  }
// ฟังก์ชันเมื่อ player พร้อมใช้งาน
function onPlayerReady(event) {
  playNextSong();  // เล่นเพลงแรกจากคิว
}

// ฟังก์ชันเมื่อสถานะของ player เปลี่ยนไป
function onPlayerStateChange(event) {
  // ตรวจสอบว่าถ้าเพลงจบ และไม่อยู่ในสถานะกำลังเล่น
  if (event.data == YT.PlayerState.ENDED && isSongPlaying) {
    isSongPlaying = false;  // รีเซ็ตสถานะ
    skipSong();  // ข้ามไปยังเพลงถัดไปในคิว
  }
}

// ฟังก์ชันสำหรับการเล่นเพลงถัดไป
function playNextSong() {
  if (songQueue.length > 1) {
    // คิวมีมากกว่า 1 เพลง ให้เล่นเพลงถัดไป
    currentPlayingIndex = (currentPlayingIndex + 1) % songQueue.length;
    const nextSong = songQueue[currentPlayingIndex];
    const videoId = extractVideoId(nextSong);
    player.loadVideoById(videoId);
    isSongPlaying = true;
  } else if (songQueue.length === 1) {
    // คิวเหลือเพลงเดียว ให้เล่นเพลงเดียวที่เหลือ
    const nextSong = songQueue[0];
    const videoId = extractVideoId(nextSong);
    player.loadVideoById(videoId);
    isSongPlaying = true;
  } else {
    // ไม่มีเพลงในคิว ให้หยุดเล่นเพลง
    isSongPlaying = false;
    currentPlayingIndex = -1;
    player.stopVideo();
  }
}

// ฟังก์ชันในการเพิ่มเพลงลงในคิว และเล่นเพลงถ้าคิวว่าง
function addSong() {
  const songInput = document.getElementById('songInput');
  const song = songInput.value;
  if (song) {
    socket.emit('addSong', song);
    songInput.value = '';
    if (songQueue.length === 0) {  // ถ้าคิวว่าง ให้เล่นเพลงใหม่ทันที
        // ถ้าเป็นเพลงแรกในคิว
        if (songQueue.length === 1) {
            // เริ่มเล่นเพลงแรก
            playNextSong();
        }  else {
        queueUpdated();  // อัปเดต UI ถ้าไม่ใช่เพลงแรก
        }
      
    }
  }
}

// ฟังก์ชันในการข้ามเพลง
function skipSong() {
  currentPlayingIndex = -1; // รีเซ็ตสถานะเมื่อข้ามเพลง
  isSongPlaying = false;  // รีเซ็ตสถานะเมื่อข้ามเพลง
  socket.emit('skipSong');
  if (songQueue.length > 0) {
    songQueue.shift();  // ลบเพลงปัจจุบันออกจากคิว
    socket.emit('queueUpdated', songQueue);
    playNextSong();  // เล่นเพลงถัดไปถ้ามีในคิว
  } else {
    isSongPlaying = false;  // รีเซ็ตสถานะเมื่อไม่มีเพลงเหลือในคิว
    player.stopVideo();  // หยุดวิดีโอเมื่อไม่มีเพลงในคิว
  }
}

function removeSong(index) {
  // ถ้าคิวเพลงเหลือเพลงเดียว
  if (songQueue.length === 1 && index === currentPlayingIndex) {
    // ไม่รีเซ็ตหรือหยุดเล่นเพลง แค่ลบออกจากคิว
    socket.emit('removeSong', index);
    // ไม่ต้องเรียก playNextSong() หรือทำอะไรเพิ่มเติม
  } else if (index !== currentPlayingIndex) {
    // ลบเพลงที่ไม่ได้กำลังเล่นอยู่
    socket.emit('removeSong', index);
    
    // อัปเดต currentPlayingIndex ถ้าจำเป็น
    if (index < currentPlayingIndex) {
      currentPlayingIndex--;
    }
  }
}

function moveSong(fromIndex, toIndex) {
  socket.emit('moveSong', fromIndex, toIndex);
}

// ฟังก์ชันที่ใช้ในการดึง Video ID จากลิงก์ YouTube
function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}


socket.on('queueUpdated', (queue) => {
    songQueue = queue;
    const queueList = document.getElementById('queue');
    queueList.innerHTML = '';
  
    queue.forEach((song, index) => {
      // ซ่อนเพลงที่กำลังเล่นอยู่จาก UI
      if (index === currentPlayingIndex || (currentPlayingIndex === -1 && index === 0)) {
        return;
      }
      const listItem = document.createElement('div');
      listItem.className = 'list-group-item song-item';
      
      // ดึง videoId จาก URL หรือข้อมูลที่มี
      const videoId = extractVideoId(song);
  
      // สร้าง Loading Indicator
      const loadingIndicator = document.createElement('div');
      loadingIndicator.textContent = 'กำลังโหลด...';
      loadingIndicator.className = 'spinner-border text-primary';
      listItem.appendChild(loadingIndicator);
  
      // เพิ่ม listItem เข้าไปใน queueList ทันที เพื่อให้เห็น Loading Indicator
      queueList.appendChild(listItem);
  
      // ดึงข้อมูลจาก YouTube API
      fetchVideoDetails(
        videoId,
        (videoDetails) => {
          // ลบ Loading Indicator
          listItem.removeChild(loadingIndicator);
  
          const title = videoDetails.title;
          const thumbnail = videoDetails.thumbnail;
  
          const thumbnailImg = document.createElement('img');
          thumbnailImg.src = thumbnail;
          thumbnailImg.alt = title;
          thumbnailImg.className = 'me-3';
  
          const titleText = document.createElement('span');
          titleText.textContent = title;
          titleText.className = 'd-flex';
  
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
          // จัดการกับข้อผิดพลาด
          listItem.removeChild(loadingIndicator);
          const errorText = document.createElement('span');
          errorText.textContent = 'ไม่สามารถโหลดข้อมูลวิดีโอได้';
          errorText.className = 'text-danger';
          listItem.appendChild(errorText);
          socket.emit('removeSong', index);
        }
      );
    });
  
    if (songQueue.length === 1) {  // ถ้ามีเพลงเดียวในคิว ให้เล่นเพลงใหม่ทันที
      playNextSong();
    }
  });
