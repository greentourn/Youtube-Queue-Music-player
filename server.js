const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);


let songQueue = [];

app.use(express.static('public'));


io.on('connection', (socket) => {
  // ส่งคิวเพลงให้ผู้ใช้ใหม่
  socket.emit('queueUpdated', songQueue);

  // รับเพลงใหม่จากผู้ใช้
  socket.on('addSong', (song) => {
    songQueue.push(song);
    io.emit('queueUpdated', songQueue);
  });

  // รับคำสั่งข้ามเพลง
  socket.on('skipSong', () => {
    songQueue.shift();
    io.emit('queueUpdated', songQueue);
  });

  // รับคำสั่งลบเพลง
  socket.on('removeSong', (index) => {
    if (index > -1 && index < songQueue.length) {
      songQueue.splice(index, 1);
      io.emit('queueUpdated', songQueue);
    }
  });

  // รับคำสั่งย้ายตำแหน่งเพลง
  socket.on('moveSong', (fromIndex, toIndex) => {
    if (
      fromIndex > -1 && fromIndex < songQueue.length &&
      toIndex > -1 && toIndex < songQueue.length
    ) {
      const [movedSong] = songQueue.splice(fromIndex, 1);
      songQueue.splice(toIndex, 0, movedSong);
      io.emit('queueUpdated', songQueue);
    }
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
