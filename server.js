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

  socket.on('addSong', (song) => {
    songQueue.push(song);
    io.emit('queueUpdated', songQueue);

    // If no song is currently playing, start the new song
    if (!currentPlaybackState.videoId || !currentPlaybackState.isPlaying) {
      const videoId = extractVideoId(song);
      currentPlaybackState = {
        videoId,
        timestamp: 0,
        isPlaying: true,
        lastUpdate: Date.now()
      };
      io.emit('playbackState', currentPlaybackState);
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

});


function extractVideoId(url) {
  const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return videoIdMatch ? videoIdMatch[1] : null;
}

server.listen(3000, () => {
  console.log('listening on *:3000');
});