require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const chatWithAI = require('./ChatBot/chatAI');
const DiscordMusicBot = require('./ChatBot/discord-bot');
const YouTubeService = require('./services/youtubeService-server');
const QueueService = require('./services/queueService');
const StateService = require('./services/stateService');
const SocketService = require('./services/socketService-server');
const ServerPlayerService = require('./services/serverPlayerService');
const packageInfo = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize services
const youtubeService = new YouTubeService(process.env.YOUTUBE_API_KEY);
const queueService = new QueueService();
const stateService = new StateService();

// Initialize server-side player service
const serverPlayer = new ServerPlayerService(youtubeService, queueService, stateService);

// Initialize socket service with server player reference
const socketService = new SocketService(io, youtubeService, queueService, stateService, serverPlayer);

// Connect server player events to socket.io broadcasting
serverPlayer.on('queueUpdated', (queue) => {
  io.emit('queueUpdated', queue);
});

serverPlayer.on('playbackState', (state) => {
  io.emit('playbackState', state);
});

// Start server-side player
serverPlayer.start();

// Initialize Discord bot
const discordBot = new DiscordMusicBot(
  io,
  queueService.getQueue(),
  stateService.getState(),
  chatWithAI
);
discordBot.start(process.env.DISCORD_TOKEN);

app.get('/version', (req, res) => {
  res.json({ version: packageInfo.version });
});

// Setup routes
app.get('/server-time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

app.get('/youtube-info/:videoId', async (req, res) => {
  try {
    const videoInfo = await youtubeService.getVideoInfo(req.params.videoId);
    res.json(videoInfo);
  } catch (error) {
    res.status(500).send('Error retrieving video details');
  }
});

app.get('/current-state', (req, res) => {
  const currentState = stateService.getState();
  const currentTime = Date.now();
  const timeDiff = (currentTime - currentState.lastUpdate) / 1000;
  const adjustedTimestamp = currentState.isPlaying
    ? currentState.timestamp + timeDiff
    : currentState.timestamp;

  res.json({
    songQueue: queueService.getQueue(),
    currentPlaybackState: {
      ...currentState,
      timestamp: adjustedTimestamp
    }
  });
});

app.use(express.static('public'));

// Start socket handlers
socketService.setupSocketHandlers();

// Start server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});