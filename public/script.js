const socket = io();
let player;  // ตัวแปรที่จะเก็บ YouTube player instance
let currentPlayingIndex = -1;
let isSongPlaying = false;

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

function fetchVideoDetails(videoId, onSuccess, onError) {
  fetch(`/youtube-info/${videoId}`)
      .then(response => response.json())
      .then(onSuccess)
      .catch(onError);
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
  if (songQueue.length > 0 || player && typeof player.loadVideoById === 'function') {
      const nextSong = songQueue[0];
      const videoId = extractVideoId(nextSong);
      player.loadVideoById(videoId);
      isSongPlaying = true;
      currentPlayingIndex = 0;  // ตั้งค่าสถานะเป็นกำลังเล่น
      
      // อัปเดตชื่อเพลงที่กำลังเล่น
      fetchVideoDetails(videoId, (videoDetails) => {
          const nowPlayingTitle = document.getElementById('nowPlaying');
          nowPlayingTitle.textContent = `กำลังเล่น: ${videoDetails.title}`;
      });
      
      
  } else {
      isSongPlaying = false;
      currentPlayingIndex = -1;  // ถ้าคิวเพลงว่าง ให้รีเซ็ตสถานะการเล่น
      // หยุดเล่นเพลง
      player.stopVideo();
      
      // ลบชื่อเพลงเมื่อไม่มีเพลงเล่น
      const nowPlayingTitle = document.getElementById('nowPlaying');
      nowPlayingTitle.textContent = 'ไม่มีเพลง';
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
  const listItem = document.querySelectorAll('.song-item')[index-1];
  listItem.classList.add('fade-out');
    // ถ้าคิวเพลงเหลือเพลงเดียว
  if (songQueue.length === 1 && index === currentPlayingIndex) {
    setTimeout(() => {
      socket.emit('removeSong', index);
    }, 300);
  } else if (index !== currentPlayingIndex) {
    setTimeout(() => {
      socket.emit('removeSong', index);
    }, 300);
    
    // อัปเดต currentPlayingIndex ถ้าจำเป็น
    if (index < currentPlayingIndex) {
      currentPlayingIndex--;
    }
  }
}

function moveSong(fromIndex, toIndex) {
  const songItems = document.querySelectorAll('.song-item');
  const movingItem = songItems[fromIndex-1];
  
  // ตรวจสอบทิศทางการย้าย
  const direction = toIndex < fromIndex ? 'move-up' : 'move-down';
  
  // เพิ่มคลาสแอนิเมชันให้กับ element ที่ย้าย
  movingItem.classList.add(direction);

  // รอให้แอนิเมชันเสร็จสิ้นก่อนส่งข้อมูลไปยังเซิร์ฟเวอร์
  setTimeout(() => {
    // ลบคลาสแอนิเมชันหลังจากย้ายเสร็จ
    movingItem.classList.remove(direction);
    
    // ส่งข้อมูลการย้ายไปยังเซิร์ฟเวอร์
    socket.emit('moveSong', fromIndex, toIndex);
  }, 300); // 300ms ต้องตรงกับระยะเวลาของแอนิเมชันใน CSS
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

      // เพิ่มคลาสแอนิเมชัน fade-in
      listItem.classList.add('fade-in');
  
      // เพิ่ม listItem เข้าไปใน queueList ทันที เพื่อให้เห็น Loading Indicator
      queueList.appendChild(listItem);
      
      // ดึงข้อมูลจาก YouTube API
      fetchVideoDetails(
        videoId,
        (videoDetails) => {
          // ลบ Loading Indicator
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
