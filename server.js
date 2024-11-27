require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let songQueue = [];
let currentPlaybackState = {
  videoId: null,
  timestamp: 0,
  isPlaying: false,
  lastUpdate: Date.now()
};

app.get('/youtube-info/:videoId', (req, res) => {
  const videoId = req.params.videoId;
  const apiKey = process.env.YOUTUBE_API_KEY;
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet`;

  axios.get(url)
    .then(response => {
      res.json(response.data.items[0].snippet);
    })
    .catch(error => {
      res.status(500).send('Error retrieving video details');
    });
});

app.get('/current-state', (req, res) => {
  res.json({
    songQueue,
    currentPlaybackState
  });
});

app.use(express.static('public'));

io.on('connection', (socket) => {
  // Send current state to new user
  socket.emit('initialState', {
    songQueue,
    currentPlaybackState
  });

  socket.on('updatePlaybackState', (state) => {
    currentPlaybackState = {
      ...state,
      lastUpdate: Date.now()
    };
    socket.broadcast.emit('playbackState', currentPlaybackState)
  });

  socket.on('addSong', async (input) => {
    const videoId = extractVideoId(input);
    const playlistId = extractPlaylistId(input);

    if (playlistId && videoId) {
      try {
        const apiKey = process.env.YOUTUBE_API_KEY;
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`;
        const response = await axios.get(url);

        // หา index ของวิดีโอที่ user เลือกใน playlist
        let startIndex = response.data.items.findIndex(
          item => item.snippet.resourceId.videoId === videoId
        );

        if (startIndex === -1) startIndex = 0;

        // สร้าง array ของวิดีโอโดยเริ่มจากวิดีโอที่เลือก
        const videos = [
          ...response.data.items.slice(startIndex),
          ...response.data.items.slice(0, startIndex)
        ].map(item => `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`);

        // ส่งข้อมูล playlist และ originalVideo กลับไปให้ client เลือก
        socket.emit('playlistFound', {
          videos,
          playlistId,
          originalVideo: input
        });
      } catch (error) {
        console.error('Error fetching playlist:', error);
        // ถ้าเกิดข้อผิดพลาด ให้เพิ่มเป็น single video
        if (videoId) {
          songQueue.push(input);
          io.emit('queueUpdated', songQueue);

          if (!currentPlaybackState.videoId || !currentPlaybackState.isPlaying) {
            currentPlaybackState = {
              videoId,
              timestamp: 0,
              isPlaying: true,
              lastUpdate: Date.now()
            };
            io.emit('playbackState', currentPlaybackState);
          }
        }
      }
    } else if (videoId) {
      // กรณีเป็น single video ใช้โค้ดเดิม
      songQueue.push(input);
      io.emit('queueUpdated', songQueue);

      if (!currentPlaybackState.videoId || !currentPlaybackState.isPlaying) {
        currentPlaybackState = {
          videoId,
          timestamp: 0,
          isPlaying: true,
          lastUpdate: Date.now()
        };
        io.emit('playbackState', currentPlaybackState);
      }
    }
  });

  socket.on('skipSong', () => {
    if (songQueue.length > 0) {
      songQueue.shift();
      io.emit('queueUpdated', songQueue);

      if (songQueue.length > 0) {
        const nextVideoId = extractVideoId(songQueue[0]);
        currentPlaybackState = {
          videoId: nextVideoId,
          timestamp: 0,
          isPlaying: true,
          lastUpdate: Date.now()
        };
        io.emit('playbackState', currentPlaybackState);
      } else {
        currentPlaybackState = {
          videoId: null,
          timestamp: 0,
          isPlaying: false,
          lastUpdate: Date.now()
        };
        io.emit('playbackState', currentPlaybackState);
      }
    }
  });

  socket.on('removeSong', (index) => {
    if (index >= 0 && index < songQueue.length) {
      songQueue.splice(index, 1);
      io.emit('queueUpdated', songQueue);

      if (index === 0) {
        if (songQueue.length > 0) {
          const nextVideoId = extractVideoId(songQueue[0]);
          currentPlaybackState = {
            videoId: nextVideoId,
            timestamp: 0,
            isPlaying: true,
            lastUpdate: Date.now()
          };
        } else {
          currentPlaybackState = {
            videoId: null,
            timestamp: 0,
            isPlaying: false,
            lastUpdate: Date.now()
          };
        }
        io.emit('playbackState', currentPlaybackState);
      }
    }
  });

  socket.on('moveSong', (fromIndex, toIndex) => {
    if (
      fromIndex >= 0 && fromIndex < songQueue.length &&
      toIndex >= 0 && toIndex < songQueue.length
    ) {
      const [movedSong] = songQueue.splice(fromIndex, 1);
      songQueue.splice(toIndex, 0, movedSong);
      io.emit('queueUpdated', songQueue);
    }
  });

  socket.on('addPlaylistVideos', (videos) => {
    videos.forEach(video => {
      songQueue.push(video);
    });
    io.emit('queueUpdated', songQueue);

    if (!currentPlaybackState.videoId || !currentPlaybackState.isPlaying) {
      const firstVideoId = extractVideoId(videos[0]);
      if (firstVideoId) {
        currentPlaybackState = {
          videoId: firstVideoId,
          timestamp: 0,
          isPlaying: true,
          lastUpdate: Date.now()
        };
        io.emit('playbackState', currentPlaybackState);
      }
    }
  });

  socket.on('clearQueue', () => {
    if (songQueue.length > 1) {
      // เก็บเพลงที่กำลังเล่นอยู่
      const currentSong = songQueue[0];
      // เคลียร์คิวทั้งหมดยกเว้นเพลงที่กำลังเล่น
      songQueue = [currentSong];
      // แจ้งเตือนการอัพเดทคิวไปยังทุก client
      io.emit('queueUpdated', songQueue);
    }
  });

  socket.on('playSongFromQueue', (index) => {
    if (index >= 0 && index < songQueue.length) {
      // เก็บเพลงที่จะเล่น
      const songToPlay = songQueue[index];
      // ลบเพลงออกจากคิว
      songQueue.splice(index, 1);
      // ใส่เพลงไว้ที่ตำแหน่งแรก
      songQueue.unshift(songToPlay);

      // อัพเดทคิวและเริ่มเล่นเพลง
      io.emit('queueUpdated', songQueue);
      const videoId = extractVideoId(songToPlay);
      currentPlaybackState = {
        videoId: videoId,
        timestamp: 0,
        isPlaying: true,
        lastUpdate: Date.now()
      };
      io.emit('playbackState', currentPlaybackState);
    }
  });

});


function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}

app.get('/playlist-info/:playlistId', async (req, res) => {
  const playlistId = req.params.playlistId;
  const apiKey = process.env.YOUTUBE_API_KEY;
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const items = response.data.items.map(item => ({
      title: item.snippet.title,
      videoId: item.snippet.resourceId.videoId,
      thumbnail: item.snippet.thumbnails.default.url
    }));
    res.json(items);
  } catch (error) {
    res.status(500).send('Error retrieving playlist details');
  }
});

// ปรับปรุงฟังก์ชัน extractVideoId ให้รองรับการแยก playlistId
function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}

function extractPlaylistId(url) {
  const playlistMatch = url.match(/[&?]list=([a-zA-Z0-9_-]+)/i);
  return playlistMatch ? playlistMatch[1] : null;
}

server.listen(3000, () => {
  console.log('listening on *:3000');
});