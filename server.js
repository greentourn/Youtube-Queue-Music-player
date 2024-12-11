require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const chatHistory = new Map();

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
  // Initialize chat history for new connection
  chatHistory.set(socket.id, []);

  // Send current state to new user
  socket.emit('initialState', {
    songQueue,
    currentPlaybackState
  });

  // เพิ่ม socket event listener
  socket.on('search results', ({ results, message }) => {
    showSearchResults(results, message);
  });

  // Handle chat messages
  socket.on('chat message', async (message) => {
    try {
      const currentVideoId = currentPlaybackState.videoId;
      let currentSong = null;

      if (currentVideoId) {
        try {
          const response = await axios.get(
            `https://www.googleapis.com/youtube/v3/videos?id=${currentVideoId}&key=${process.env.YOUTUBE_API_KEY}&part=snippet`
          );
          currentSong = {
            title: response.data.items[0].snippet.title,
            videoId: currentVideoId
          };
        } catch (error) {
          console.error('Error fetching video details:', error);
        }
      }

      // อัพเดทประวัติแชท
      const history = chatHistory.get(socket.id);
      history.push({ role: "user", content: message });
      if (history.length > 10) history.shift();

      // ขอคำตอบจาก AI
      const response = await chatWithAI(history, currentSong, songQueue);
      history.push({ role: "assistant", content: response });

      // ตรวจสอบคำสั่งควบคุม
      const commandMatch = response.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);
      if (commandMatch) {
        const command = commandMatch[1];
        const param = commandMatch[2];

        // จัดการคำสั่งโดยตรง
        switch (command) {
          case 'play':
            if (!currentPlaybackState.isPlaying && currentPlaybackState.videoId) {
              currentPlaybackState = {
                ...currentPlaybackState,
                isPlaying: true,
                lastUpdate: Date.now()
              };
              io.emit('playbackState', currentPlaybackState);
            }
            break;

          case 'pause':
            if (currentPlaybackState.isPlaying) {
              // อัพเดท timestamp ให้ตรงกับเวลาที่หยุด
              const currentTime = Date.now();
              const timeDiff = (currentTime - currentPlaybackState.lastUpdate) / 1000;
              currentPlaybackState = {
                ...currentPlaybackState,
                timestamp: currentPlaybackState.timestamp + (currentPlaybackState.isPlaying ? timeDiff : 0),
                isPlaying: false,
                lastUpdate: currentTime
              };
              io.emit('playbackState', currentPlaybackState);
            }
            break;

          case 'skip':
            if (songQueue.length > 0) {
              // ลบเพลงปัจจุบันออกจากคิว
              songQueue.shift();
              io.emit('queueUpdated', songQueue);

              if (songQueue.length > 0) {
                // ถ้ายังมีเพลงในคิว ให้เล่นเพลงถัดไปทันที
                const nextVideoId = extractVideoId(songQueue[0]);
                currentPlaybackState = {
                  videoId: nextVideoId,
                  timestamp: 0,
                  isPlaying: true,
                  lastUpdate: Date.now()
                };
              } else {
                // ถ้าไม่มีเพลงในคิวแล้ว
                currentPlaybackState = {
                  videoId: null,
                  timestamp: 0,
                  isPlaying: false,
                  lastUpdate: Date.now()
                };
              }
              // ส่ง state ใหม่ไปที่ client ทันที
              io.emit('playbackState', currentPlaybackState);
            }
            break;

          case 'clear':
            if (songQueue.length > 1) {
              const currentSong = songQueue[0];
              songQueue = [currentSong];
              io.emit('queueUpdated', songQueue);
            }
            break;

          case 'remove':
            if (param && Number(param) > 0 && Number(param) < songQueue.length) {
              songQueue.splice(Number(param), 1);
              io.emit('queueUpdated', songQueue);
            }
            break;
        }

        socket.emit('chat response', {
          message: response.replace(/\[COMMAND:\w+(?::\d+)?\]/g, '').trim(),
          isCommand: true
        });
        return;
      }

      // ตรวจสอบคำสั่งค้นหา
      const searchMatch = response.match(/\[SEARCH:(.*?)\]/);
      if (searchMatch) {
        const searchQuery = searchMatch[1].trim();
        try {
          const searchResults = await searchYouTubeVideos(searchQuery);
          if (searchResults.length > 0) {
            socket.emit('search results', {
              results: searchResults,
              message: response.replace(/\[SEARCH:.*?\]/, '').trim()
            });
          } else {
            socket.emit('chat response', {
              message: "ขออภัย ฉันไม่พบเพลงที่คุณต้องการ กรุณาลองใหม่อีกครั้ง",
              isCommand: false
            });
          }
          return;
        } catch (error) {
          console.error('Error searching videos:', error);
          socket.emit('chat response', {
            message: "ขออภัย เกิดข้อผิดพลาดในการค้นหาเพลง กรุณาลองใหม่อีกครั้ง",
            isCommand: false
          });
        }
        return;
      }

      // ส่งข้อความปกติ
      socket.emit('chat response', {
        message: response,
        isCommand: false
      });

    } catch (error) {
      console.error('Error processing chat:', error);
      socket.emit('chat response', {
        message: "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง",
        isCommand: false
      });
    }
  });

  // Handle playback state updates
  socket.on('updatePlaybackState', (state) => {
    currentPlaybackState = {
      ...state,
      lastUpdate: Date.now()
    };
    socket.broadcast.emit('playbackState', currentPlaybackState);
  });

  // Handle adding songs
  socket.on('addSong', async (input) => {
    const videoId = extractVideoId(input);
    const playlistId = extractPlaylistId(input);

    if (playlistId && videoId) {
      try {
        const apiKey = process.env.YOUTUBE_API_KEY;
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${apiKey}`;
        const response = await axios.get(url);

        let startIndex = response.data.items.findIndex(
          item => item.snippet.resourceId.videoId === videoId
        );

        if (startIndex === -1) startIndex = 0;

        const videos = [
          ...response.data.items.slice(startIndex),
          ...response.data.items.slice(0, startIndex)
        ].map(item => `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`);

        socket.emit('playlistFound', {
          videos,
          playlistId,
          originalVideo: input
        });
      } catch (error) {
        console.error('Error fetching playlist:', error);
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

  // Handle skipping songs
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

  // Handle removing songs
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

  // Handle moving songs in queue
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

  // Handle adding playlist videos
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

  // Handle clearing queue
  socket.on('clearQueue', () => {
    if (songQueue.length > 1) {
      const currentSong = songQueue[0];
      songQueue = [currentSong];
      io.emit('queueUpdated', songQueue);
    }
  });

  // Handle playing song from queue
  socket.on('playSongFromQueue', (index) => {
    if (index >= 0 && index < songQueue.length) {
      const songToPlay = songQueue[index];
      songQueue.splice(index, 1);

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

  // Handle disconnection
  socket.on('disconnect', () => {
    chatHistory.delete(socket.id);
  });
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

// Function สำหรับค้นหาเพลงจาก YouTube
async function searchYouTubeVideos(query) {
  try {
    console.log('Searching YouTube for:', query); // Debug log
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: query,
        type: 'video',
        videoCategoryId: '10',
        maxResults: 5,
        key: process.env.YOUTUBE_API_KEY
      }
    });

    if (!response.data.items || response.data.items.length === 0) {
      console.log('No results found'); // Debug log
      return [];
    }

    const results = response.data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium.url,
      channel: item.snippet.channelTitle
    }));

    console.log('Processed results:', results); // Debug log
    return results;

  } catch (error) {
    console.error('YouTube search error:', error);
    throw error;
  }
}

// ปรับปรุงฟังก์ชัน chatWithAI
async function chatWithAI(messages, currentSong, songQueue) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Gemini API key is not configured');
    }

    // Ensure messages are valid
    if (!Array.isArray(messages) || messages.some(msg => !msg.role || !msg.content)) {
      console.error('Invalid chat history format:', messages);
      return "ประวัติการสนทนาไม่ถูกต้อง";
    }

    // Extract the last user message
    const userMessage = messages[messages.length - 1].content;

    // Handle predefined control commands
    if (userMessage.match(/^(ข้าม|skip|next)$/i)) {
      return "ข้ามไปเพลงถัดไป [COMMAND:skip]";
    }
    if (userMessage.match(/^(หยุด|พัก|pause)$/i)) {
      return "หยุดเล่นชั่วคราว [COMMAND:pause]";
    }
    if (userMessage.match(/^(เล่น|play|ต่อ)$/i)) {
      return "เล่นต่อ [COMMAND:play]";
    }
    if (userMessage.match(/^(ล้างคิว|clear)$/i)) {
      return "ล้างรายการเพลงในคิว [COMMAND:clear]";
    }

    // Handle specific information requests about current song
    if (userMessage.match(/ข้อมูลเพลง|เพลงที่กำลังเล่น|เพลงอะไร|ขอข้อมูลเพลง/i)) {
      if (!currentSong) {
        return "ขณะนี้ไม่มีเพลงที่กำลังเล่นอยู่";
      }
      return `ขณะนี้กำลังเล่นเพลง: ${currentSong.title}`;
    }

    // Enhanced search patterns with better context extraction
    const searchPatterns = [
      {
        regex: /เปิดเพลง\s*(.+)/i,
        handler: (match) => processSearchRequest("เปิดเพลง", match[1])
      },
      {
        regex: /หาเพลง\s*(.+)/i,
        handler: (match) => processSearchRequest("ค้นหาเพลง", match[1])
      },
      {
        regex: /อยากฟังเพลง\s*(.+)/i,
        handler: (match) => processSearchRequest("ค้นหาเพลง", match[1])
      },
      {
        regex: /(เพลงคล้ายๆ|เพลงแนว)\s*(.+)/i,
        handler: (match) => processSearchRequest("ค้นหาเพลงแนว", match[2])
      },
      {
        regex: /แนะนำเพลงแนว\s*(.+)/i,
        handler: (match) => processSearchRequest("แนะนำเพลงแนว", match[1])
      },
      {
        regex: /ขอเพลงแนว\s*(.+)/i,
        handler: (match) => processSearchRequest("ค้นหาเพลงแนว", match[1])
      },
      {
        regex: /ขอเพลง\s*(.+)/i,
        handler: (match) => processSearchRequest("ค้นหาเพลง", match[1])
      }
    ];

    // Process search request with context
    function processSearchRequest(context, searchTerm) {
      searchTerm = searchTerm.trim();
      
      // Add context-specific keywords for better search results
      let enhancedSearch = searchTerm;
      if (searchTerm.match(/แนว|สไตล์|genre/i)) {
        enhancedSearch = searchTerm.replace(/แนว|สไตล์|genre/i, '');
      }
      
      // Add "music" or "เพลง" if not present
      if (!searchTerm.includes('music') && !searchTerm.includes('เพลง')) {
        enhancedSearch += ' เพลง';
      }
      
      return {
        searchTerm: enhancedSearch,
        response: `${context} "${searchTerm}" [SEARCH:${enhancedSearch}]`
      };
    }

    // Check for search patterns
    for (const pattern of searchPatterns) {
      const match = userMessage.match(pattern.regex);
      if (match) {
        const result = pattern.handler(match);
        return result.response;
      }
    }

    // If no search pattern matched, process as general conversation
    const prompt = `คุณคือผู้ช่วย AI ที่ช่วยจัดการเพลงและให้ข้อมูลเกี่ยวกับเพลง
    สถานะปัจจุบัน:
    ${currentSong ? `- กำลังเล่น: ${currentSong.title}` : '- ไม่มีเพลงที่กำลังเล่นอยู่'}
    - จำนวนเพลงในคิว: ${songQueue.length} เพลง
    
    คำถามจากผู้ใช้: ${userMessage}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error('Error chatting with AI:', error);
    return "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง";
  }
}


server.listen(3000, () => {
  console.log('listening on *:3000');
});