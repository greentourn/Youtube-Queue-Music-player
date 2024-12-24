const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// Command definitions with their patterns and descriptions
const COMMANDS = {
  PLAY: {
    name: "play",
    patterns: ["เล่น", "play", "ต่อ", "continue", "resume"],
    description: "เล่นเพลงที่หยุดอยู่",
  },
  PAUSE: {
    name: "pause",
    patterns: ["หยุด", "พัก", "pause", "stop"],
    description: "หยุดเพลงชั่วคราว",
  },
  SKIP: {
    name: "skip",
    patterns: ["ข้าม", "skip", "next"],
    description: "ข้ามไปเพลงถัดไป",
  },
  CLEAR: {
    name: "clear",
    patterns: ["ล้าง", "clear", "ล้างคิว", "remove all"],
    description: "ล้างรายการเพลงทั้งหมดในคิว",
  },
};

// Function to extract video ID from URL
function extractVideoId(url) {
  if (!url || typeof url !== "string") {
    console.error("Invalid URL provided to extractVideoId:", url);
    return null;
  }
  try {
    const match = url.match(
      /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  } catch (error) {
    console.error("Error extracting video ID:", error);
    return null;
  }
}

// Cache object to store video details
const videoDetailsCache = new Map();

// Function to get video details from YouTube API with caching
async function getVideoDetails(url) {
  try {
    if (!url) {
      console.error("No URL provided to getVideoDetails");
      return null;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      console.error("Could not extract video ID from URL:", url);
      return null;
    }

    // Check cache first
    if (videoDetailsCache.has(videoId)) {
      return videoDetailsCache.get(videoId);
    }

    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos`,
      {
        params: {
          part: "snippet,contentDetails,statistics",
          id: videoId,
          key: process.env.YOUTUBE_API_KEY,
        },
      }
    );

    if (response.data.items && response.data.items.length > 0) {
      const video = response.data.items[0];
      const details = {
        videoId,
        title: video.snippet.title,
        channel: video.snippet.channelTitle,
        description: video.snippet.description,
        tags: video.snippet.tags || [],
        duration: video.contentDetails.duration,
        viewCount: video.statistics.viewCount,
        likeCount: video.statistics.likeCount,
        publishedAt: video.snippet.publishedAt,
      };

      // Store in cache
      videoDetailsCache.set(videoId, details);
      return details;
    }
    return null;
  } catch (error) {
    console.error("Error fetching video details:", error);
    return null;
  }
}

// Function to get song details for queue
async function getQueueDetails(songQueue) {
  const details = await Promise.all(
    songQueue.map(async (url) => {
      const videoDetails = await getVideoDetails(url);
      if (videoDetails) {
        return `${videoDetails.title} (โดย ${videoDetails.channel})`;
      }
      return url;
    })
  );
  return details;
}

async function chatWithAI(messages, currentSong, songQueue) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Gemini API key is not configured");
    }

    // Validate chat history
    if (
      !Array.isArray(messages) ||
      messages.some((msg) => !msg.role || !msg.content)
    ) {
      console.error("Invalid chat history format:", messages);
      return "ประวัติการสนทนาไม่ถูกต้อง";
    }

    // Get the last user message
    const userMessage = messages[messages.length - 1].content;

    // Get enhanced song details
    let currentSongDetails = currentSong;
    if (currentSong && typeof currentSong === "object") {
      // Check if url exists in currentSong
      const songUrl = currentSong.url || currentSong.videoUrl;
      if (songUrl) {
        const details = await getVideoDetails(songUrl);
        if (details) {
          currentSongDetails = {
            ...currentSong,
            ...details,
          };
        }
      } else {
        console.error("No URL found in currentSong object:", currentSong);
      }
    }

    // Get queue details
    const queueDetails = await getQueueDetails(songQueue);

    // Create enhanced context for AI
    let context = `คุณเป็นผู้ช่วย AI ที่ฉลาดในการจัดการเพลงและช่วยผู้ใช้ควบคุมการเล่นเพลง

สถานะปัจจุบัน:
${
  currentSongDetails
    ? `กำลังเล่น: "${currentSongDetails.title}" ${
        currentSongDetails.channel ? `โดย ${currentSongDetails.channel}` : ""
      }${
        currentSongDetails.tags
          ? `\nแนวเพลง: ${currentSongDetails.tags.join(", ")}`
          : ""
      }${
        currentSongDetails.viewCount
          ? `\nยอดวิว: ${parseInt(
              currentSongDetails.viewCount
            ).toLocaleString()}`
          : ""
      }`
    : "ไม่มีเพลงที่กำลังเล่น"
}

จำนวนเพลงในคิว: ${songQueue.length} เพลง
${
  songQueue.length > 0
    ? "\nรายการเพลงในคิว:\n" +
      queueDetails.map((song, index) => `${index + 1}. ${song}`).join("\n")
    : ""
}

คำสั่งที่รองรับ:
${Object.values(COMMANDS)
  .map((cmd) => `- ${cmd.description} (${cmd.patterns.join(", ")})`)
  .join("\n")}

ถ้าผู้ใช้ต้องการค้นหาเพลง ให้ตอบกลับด้วย [SEARCH:คำค้นหา]
ถ้าผู้ใช้ต้องการใช้คำสั่ง ให้ตอบกลับด้วย [COMMAND:ชื่อคำสั่ง]

ตัวอย่างข้อความผู้ใช้และการตอบกลับ:
"อยากฟังเพลง butterfly" -> ควรตอบ "butterfly เป็นเพลงที่ฟังสบายๆ ดีนะ เดี๋ยวหาให้ฟังเลย [SEARCH:butterfly]"
"ข้ามเพลงนี้ที" -> ควรตอบ "ได้เลย เดี๋ยวเปลี่ยนไปเพลงถัดไปให้นะ [COMMAND:skip]"
"เพลงนี้เพราะดี" -> ควรตอบ "จริงๆ นะ ชอบท่อนทำนองกับเนื้อร้องมากเลย เป็นเพลงที่ฟังกี่ครั้งก็ไม่เบื่อ"
"อยากฟังเพลงเศร้าๆ" -> ควรตอบ "เข้าใจความรู้สึกเลย เดี๋ยวหาเพลงเศร้าๆ ที่เข้ากับบรรยากาศให้นะ [SEARCH:เพลงเศร้า ballad]"

คำถามจากผู้ใช้: ${userMessage}

วิเคราะห์ข้อความและเลือกการตอบกลับที่เหมาะสม โดยพิจารณาจาก:
1. หากเป็นการขอข้อมูลเกี่ยวกับเพลงปัจจุบันหรือคิว ให้ตอบข้อมูลนั้นโดยใช้ข้อมูลที่มี
2. หากเป็นการขอค้นหาเพลง ให้ใช้ [SEARCH:] และใช้ข้อมูลแท็กหรือศิลปินที่เกี่ยวข้องช่วยในการค้นหา
3. หากเป็นการขอควบคุมการเล่น ให้ใช้ [COMMAND:]
4. หากเป็นการสนทนาทั่วไป ให้ตอบอย่างเป็นธรรมชาติ`;

    // Generate AI response
    const result = await model.generateContent(context);
    const response = await result.response;

    if (!response || !response.text()) {
      throw new Error("Invalid AI response");
    }

    const aiResponse = response.text();

    // Process the response for enhanced search
    const searchMatch = aiResponse.match(/\[SEARCH:(.*?)\]/);
    if (searchMatch) {
      const searchTerm = searchMatch[1].trim();
      let enhancedSearch = searchTerm;

      // Add music-related keywords if not present
      if (!searchTerm.includes("music") && !searchTerm.includes("เพลง")) {
        enhancedSearch += " เพลง";
      }

      // Add relevant artist or genre if available from current song
      if (currentSongDetails?.tags) {
        const relevantTags = currentSongDetails.tags.filter((tag) =>
          searchTerm.toLowerCase().includes(tag.toLowerCase())
        );
        if (relevantTags.length > 0) {
          enhancedSearch += ` ${currentSongDetails.channel}`;
        }
      }

      // Replace the original search term with enhanced one
      return aiResponse.replace(searchMatch[0], `[SEARCH:${enhancedSearch}]`);
    }

    // Process the response for commands
    const commandMatch = aiResponse.match(/\[COMMAND:(\w+)(?::(\d+))?\]/);
    if (commandMatch) {
      const command = commandMatch[1];
      // Validate if it's a supported command
      if (Object.values(COMMANDS).some((cmd) => cmd.name === command)) {
        return aiResponse;
      }
      return "ขออภัย ไม่พบคำสั่งที่ต้องการ";
    }

    return aiResponse;
  } catch (error) {
    console.error("Error in chatWithAI:", error);
    return "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง";
  }
}

module.exports = chatWithAI;
