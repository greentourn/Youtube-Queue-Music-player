const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

class DiscordMusicBot {
  constructor(io, songQueue, currentPlaybackState, chatWithAI) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    this.songQueue = songQueue;
    this.io = io;
    this.currentPlaybackState = currentPlaybackState;
    this.chatWithAI = chatWithAI;
    this.chatHistory = new Map();
    this.webAppUrl = process.env.WEBAPP_URL || 'http://localhost:3000';
    this.searchResults = new Map();

    // รูปแบบคำสั่งค้นหาที่รองรับ
    this.searchPatterns = [
      { type: 'command', pattern: /^!(?:search|หา|find)\s+(.+)$/i },
      { type: 'text', pattern: /^(?:หาเพลง|ค้นหาเพลง)\s+(.+)$/i }
    ];

    this.setupEventHandlers();
  }

  // ฟังก์ชันแยกคำค้นหา
  parseSearchQuery(content) {
    for (const { type, pattern } of this.searchPatterns) {
      const match = content.match(pattern);
      if (match) {
        return {
          type,
          query: match[1].trim()
        };
      }
    }
    return null;
  }

  // ฟังก์ชันค้นหาวิดีโอ
  async searchYouTubeVideos(query) {
    try {
      console.log('Searching for:', query);
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

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium.url,
        channel: item.snippet.channelTitle
      }));

    } catch (error) {
      console.error('YouTube search error:', error);
      throw error;
    }
  }

  // ฟังก์ชันแสดงผลการค้นหา
  async showSearchResults(message, results) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 ผลการค้นหาเพลง')
      .setDescription('พิมพ์หมายเลข 1-5 เพื่อเลือกเพลง หรือพิมพ์ "ยกเลิก" เพื่อยกเลิกการค้นหา')
      .setFooter({ text: '⏰ ผลการค้นหาจะหมดอายุใน 1 นาที' });

    results.forEach((result, index) => {
      embed.addFields({
        name: `${index + 1}. ${result.title}`,
        value: `👤 Channel: ${result.channel}`
      });
    });

    this.searchResults.set(message.channelId, results);

    setTimeout(() => {
      if (this.searchResults.has(message.channelId)) {
        this.searchResults.delete(message.channelId);
        message.channel.send('⌛ ผลการค้นหาหมดเวลาแล้ว กรุณาค้นหาใหม่');
      }
    }, 60000);

    return message.channel.send({ embeds: [embed] });
  }

  // Event handlers หลัก
  setupEventHandlers() {
    this.client.on('ready', () => {
      console.log(`Logged in as ${this.client.user.tag}`);
    });
  
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
  
      try {
        // ตรวจสอบการตอบกลับการค้นหา
        if (this.searchResults.has(message.channelId)) {
          console.log('Found search results for channel:', message.channelId);
  
          if (message.content.toLowerCase() === 'ยกเลิก') {
            this.searchResults.delete(message.channelId);
            return message.channel.send('✅ ยกเลิกการค้นหาแล้ว');
          }
  
          // จัดการการเลือกเพลง
          const selection = parseInt(message.content);
          if (!isNaN(selection) && selection >= 1 && selection <= 5) {
            const results = this.searchResults.get(message.channelId);
            if (results && results.length >= selection) {
              const selected = results[selection - 1];
              console.log('Selected song:', selected);
  
              const videoUrl = `https://www.youtube.com/watch?v=${selected.id}`;
  
              // แสดงข้อความกำลังเพิ่มเพลง
              const waitMessage = await message.channel.send('⏳ กำลังเพิ่มเพลงเข้าคิว...');
  
              try {
                // เพิ่มเพลงเข้าคิว
                this.songQueue.push(videoUrl);
                console.log('Current queue:', this.songQueue);
  
                // แจ้ง socket
                this.io.emit('queueUpdated', this.songQueue);
                console.log('Queue update emitted');
  
                // ถ้าไม่มีเพลงเล่นอยู่ ให้เริ่มเล่นเพลงใหม่
                if (!this.currentPlaybackState.videoId || !this.currentPlaybackState.isPlaying) {
                  this.currentPlaybackState = {
                    videoId: selected.id,
                    timestamp: 0,
                    isPlaying: true,
                    lastUpdate: Date.now()
                  };
                  this.io.emit('playbackState', this.currentPlaybackState);
                  console.log('Playback state updated');
                }
  
                // ลบข้อความรอ
                await waitMessage.delete().catch(console.error);
  
                // แสดงข้อความยืนยัน
                const embed = new EmbedBuilder()
                  .setColor('#00ff00')
                  .setTitle('✅ เพิ่มเพลงเข้าคิวแล้ว')
                  .addFields(
                    { name: '🎵 เพลง', value: selected.title },
                    { name: '👤 ช่อง', value: selected.channel }
                  );
  
                if (selected.thumbnail) {
                  embed.setThumbnail(selected.thumbnail);
                }
  
                await message.channel.send({ embeds: [embed] });
                await this.showQueue(message);
  
                this.searchResults.delete(message.channelId);
                console.log('Search results cleared');
                return;
              } catch (error) {
                console.error('Error adding song:', error);
                await waitMessage.delete().catch(console.error);
                await message.channel.send('❌ เกิดข้อผิดพลาดในการเพิ่มเพลง');
                return;
              }
            }
          }
        }
  
        // จัดการคำสั่งค้นหา
        const searchQuery = this.parseSearchQuery(message.content);
        if (searchQuery) {
          if (!searchQuery.query) {
            return message.channel.send('❌ โปรดระบุชื่อเพลงที่ต้องการค้นหา');
          }
  
          const waitMessage = await message.channel.send('🔍 กำลังค้นหาเพลง...');
  
          try {
            const results = await this.searchYouTubeVideos(searchQuery.query);
            await waitMessage.delete().catch(() => { });
  
            if (results.length === 0) {
              return message.channel.send('❌ ไม่พบผลการค้นหา');
            }
  
            await this.showSearchResults(message, results);
          } catch (error) {
            console.error('Search error:', error);
            await waitMessage.delete().catch(() => { });
            return message.channel.send('❌ เกิดข้อผิดพลาดในการค้นหา');
          }
          return;
        }
  
        // จัดการคำสั่งพื้นฐาน
        if (message.content.startsWith('!')) {
          const [command, ...args] = message.content.slice(1).split(' ');
  
          switch (command.toLowerCase()) {
            case 'skip':
              await this.handleSkip(message);
              break;
            case 'queue':
              await this.showQueue(message);
              break;
            case 'clear':
              await this.clearQueue(message);
              break;
            case 'help':
              this.showHelp(message);
              break;
          }
          return;
        }
  
        // จัดการการแชทกับ AI
        const history = this.chatHistory.get(message.channelId) || [];
        history.push({ role: "user", content: message.content });
  
        const response = await this.chatWithAI(
          history,
          this.getCurrentSongInfo(),
          this.songQueue
        );
  
        await this.handleAIResponse(message, response);
  
        history.push({ role: "assistant", content: response });
        if (history.length > 10) history.shift();
        this.chatHistory.set(message.channelId, history);
  
      } catch (error) {
        console.error('Message processing error:', error);
        message.channel.send('❌ เกิดข้อผิดพลาดในการประมวลผล');
      }
    });
  }


  async createQueueEmbed() {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🎵 รายการเพลง')
      .setDescription('รายการเพลงที่อยู่ในคิว:');

    try {
      if (this.songQueue.length === 0) {
        embed.addFields({ name: 'คิวว่าง', value: 'ไม่มีเพลงในคิว' });
      } else {
        // แสดงเพลงที่กำลังเล่น
        if (this.currentPlaybackState.videoId) {
          try {
            const response = await axios.get(
              `https://www.googleapis.com/youtube/v3/videos?id=${this.currentPlaybackState.videoId}&key=${process.env.YOUTUBE_API_KEY}&part=snippet`
            );
            const currentSong = response.data.items[0].snippet.title;
            embed.addFields({
              name: '🎵 กำลังเล่น',
              value: `${currentSong}${this.currentPlaybackState.isPlaying ? ' ▶️' : ' ⏸️'}`
            });
          } catch (error) {
            console.error('Error fetching current song info:', error);
            embed.addFields({ name: '🎵 กำลังเล่น', value: 'ไม่สามารถโหลดข้อมูลเพลงได้' });
          }
        }

        // แสดงเพลงในคิว
        let queueText = '';
        for (let i = 1; i < Math.min(this.songQueue.length, 6); i++) {
          const videoId = this.extractVideoId(this.songQueue[i]);
          try {
            const response = await axios.get(
              `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.YOUTUBE_API_KEY}&part=snippet`
            );
            queueText += `${i}. ${response.data.items[0].snippet.title}\n`;
          } catch (error) {
            console.error('Error fetching queue song info:', error);
            queueText += `${i}. (ไม่สามารถโหลดข้อมูลเพลงได้)\n`;
          }
        }

        if (queueText) {
          embed.addFields({ name: '📋 เพลงในคิว', value: queueText });
        }

        if (this.songQueue.length > 6) {
          embed.addFields({
            name: '... และอีก',
            value: `${this.songQueue.length - 6} เพลง`
          });
        }
      }

      embed.addFields({
        name: '🌐 เว็บแอพ',
        value: `จัดการเพลงเพิ่มเติมได้ที่: ${this.webAppUrl}`
      });

    } catch (error) {
      console.error('Error creating queue embed:', error);
      embed.setDescription('❌ เกิดข้อผิดพลาดในการโหลดข้อมูลคิว');
    }

    return embed;
  }

  extractVideoId(url) {
    const videoIdMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return videoIdMatch ? videoIdMatch[1] : null;
  }


  async handleSkip(message) {
    if (this.songQueue.length > 0) {
      this.songQueue.shift();
      this.io.emit('queueUpdated', this.songQueue);

      if (this.songQueue.length > 0) {
        const nextVideoId = this.extractVideoId(this.songQueue[0]);
        this.currentPlaybackState = {
          videoId: nextVideoId,
          timestamp: 0,
          isPlaying: true,
          lastUpdate: Date.now()
        };
      } else {
        this.currentPlaybackState = {
          videoId: null,
          timestamp: 0,
          isPlaying: false,
          lastUpdate: Date.now()
        };
      }

      this.io.emit('playbackState', this.currentPlaybackState);
      message.channel.send('ข้ามเพลงแล้ว');
      await this.showQueue(message);
    } else {
      message.channel.send('ไม่มีเพลงในคิว');
    }
  }

  async showQueue(message) {
    const embed = await this.createQueueEmbed();
    message.channel.send({ embeds: [embed] });
  }

  async clearQueue(message) {
    if (this.songQueue.length > 1) {
      const currentSong = this.songQueue[0];
      this.songQueue = [currentSong];
      this.io.emit('queueUpdated', this.songQueue);
      message.channel.send('ล้างคิวเพลงแล้ว');
      await this.showQueue(message);
    } else {
      message.channel.send('ไม่มีเพลงในคิว');
    }
  }

  showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🤖 คำสั่งทั้งหมด')
      .addFields(
        { name: '!search หรือ !หา', value: 'ค้นหาเพลง เช่น "!search ดอกไม้" หรือ "!หา butterfly"' },
        { name: '!skip', value: 'ข้ามเพลงปัจจุบัน' },
        { name: '!queue', value: 'แสดงรายการเพลงในคิว' },
        { name: '!clear', value: 'ล้างคิวเพลง' },
        { name: 'AI Music Assistant', value: 'พิมพ์ข้อความปกติเพื่อสื่อสารกับ AI เช่น\n- "เปิดเพลง butterfly"\n- "ขอเพลงแนวร็อค"\n- "เพลงที่กำลังเล่นคือเพลงอะไร"\n- "ช่วยข้ามเพลงให้หน่อย"' }
      )
      .setFooter({ text: `เว็บแอพ: ${this.webAppUrl}` });

    message.channel.send({ embeds: [embed] });
  }

  async handleAIResponse(message, response) {
    try {
      // แยกการจัดการ SEARCH command ออกมาก่อน
      const searchMatch = response.match(/\[SEARCH:(.*?)\]/);
      if (searchMatch) {
        const searchQuery = searchMatch[1].trim();
        console.log('AI Search query:', searchQuery); // Debug log

        // ส่งข้อความกำลังค้นหา
        const waitMessage = await message.channel.send('🔍 กำลังค้นหาเพลง...');

        try {
          const results = await this.searchYouTubeVideos(searchQuery);
          console.log('Search results:', results); // Debug log

          // ลบข้อความรอ
          await waitMessage.delete().catch(console.error);

          if (results.length === 0) {
            return message.channel.send('❌ ไม่พบผลการค้นหา');
          }

          // แสดงผลการค้นหา
          await this.showSearchResults(message, results);

          // ส่งข้อความจาก AI (ถ้ามี) โดยตัด [SEARCH:] ออก
          const aiMessage = response.replace(/\[SEARCH:.*?\]/, '').trim();
          if (aiMessage) {
            message.channel.send(aiMessage);
          }
        } catch (error) {
          console.error('Error in AI search:', error);
          await waitMessage.delete().catch(console.error);
          message.channel.send('❌ เกิดข้อผิดพลาดในการค้นหา');
        }
        return;
      }

      // จัดการ command อื่นๆ
      const commandMatch = response.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);
      if (commandMatch) {
        const command = commandMatch[1];
        switch (command) {
          case 'skip':
            await this.handleSkip(message);
            break;
          case 'clear':
            await this.clearQueue(message);
            break;
          case 'play':
            if (this.currentPlaybackState.videoId) {
              this.currentPlaybackState.isPlaying = true;
              this.currentPlaybackState.lastUpdate = Date.now();
              this.io.emit('playbackState', this.currentPlaybackState);
            }
            break;
          case 'pause':
            if (this.currentPlaybackState.videoId) {
              this.currentPlaybackState.isPlaying = false;
              this.currentPlaybackState.lastUpdate = Date.now();
              this.io.emit('playbackState', this.currentPlaybackState);
            }
            break;
        }

        // ส่งข้อความ AI โดยตัด [COMMAND:] ออก
        const displayMessage = response.replace(/\[COMMAND:\w+(?::\d+)?\]/g, '').trim();
        if (displayMessage) {
          message.channel.send(displayMessage);
        }
        return;
      }

      // ถ้าไม่มี command พิเศษ ส่งข้อความปกติ
      if (response.trim()) {
        message.channel.send(response);
      }
    } catch (error) {
      console.error('Error in handleAIResponse:', error);
      message.channel.send('❌ เกิดข้อผิดพลาดในการประมวลผล');
    }
  }

  getCurrentSongInfo() {
    if (!this.currentPlaybackState.videoId) return null;

    return {
      videoId: this.currentPlaybackState.videoId,
      isPlaying: this.currentPlaybackState.isPlaying
    };
  }

  start(token) {
    this.client.login(token);
  }
}

module.exports = DiscordMusicBot;