const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Initialize Gemini API with retry mechanism
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash"
});

// Enhanced command definitions with more natural language patterns and new commands
const COMMANDS = {
  PLAY: {
    name: "play",
    patterns: [
      "เล่น",
      "play",
      "ต่อ",
      "continue",
      "resume",
      "เปิดเพลง",
      "เริ่มเล่น",
    ],
    description: "เล่นเพลงที่หยุดอยู่",
    contextTriggers: ["อยากฟังต่อ", "เปิดให้ฟังหน่อย", "ขอฟังต่อ"],
  },
  PAUSE: {
    name: "pause",
    patterns: ["หยุด", "พัก", "pause", "stop", "พักก่อน", "หยุดก่อน"],
    description: "หยุดเพลงชั่วคราว",
    contextTriggers: ["ขอพักก่อน", "เดี๋ยวค่อยฟังต่อ"],
  },
  SKIP: {
    name: "skip",
    patterns: ["ข้าม", "skip", "next", "เปลี่ยนเพลง", "ไปเพลงถัดไป"],
    description: "ข้ามไปเพลงถัดไป",
    contextTriggers: ["ไม่ชอบเพลงนี้", "เบื่อเพลงนี้แล้ว", "อยากฟังเพลงอื่น"],
  },
  CLEAR: {
    name: "clear",
    patterns: ["ล้าง", "clear", "ล้างคิว", "remove all", "เคลียร์"],
    description: "ล้างรายการเพลงทั้งหมดในคิว",
    contextTriggers: ["ล้างรายการทั้งหมด", "เริ่มใหม่หมด"],
  },
};

// Mood and Genre Analysis System
const MOOD_PATTERNS = {
  HAPPY: {
    keywords: ["สนุก", "happy", "สดใส", "รื่นเริง", "มีความสุข"],
    searchTerms: ["เพลงสนุก", "happy songs", "party songs"],
  },
  SAD: {
    keywords: ["เศร้า", "sad", "เหงา", "อกหัก", "ความรัก"],
    searchTerms: ["เพลงเศร้า", "sad songs", "ballad"],
  },
  CHILL: {
    keywords: ["ชิล", "chill", "สบาย", "ผ่อนคลาย"],
    searchTerms: ["เพลงชิล", "chill songs", "lofi"],
  },
  ENERGETIC: {
    keywords: ["มันส์", "energetic", "เต้น", "workout"],
    searchTerms: ["เพลงมันส์", "dance music", "workout songs"],
  },
};

// Music Genre Recommendations
const GENRE_RECOMMENDATIONS = new Map([
  ["pop", ["pop", "dance pop", "contemporary pop"]],
  ["rock", ["alternative rock", "indie rock", "classic rock"]],
  ["hip hop", ["rap", "trap", "urban"]],
  ["jazz", ["smooth jazz", "blues", "swing"]],
  ["classical", ["orchestra", "piano", "instrumental"]],
]);

// Enhanced video details cache with TTL
class CacheWithTTL {
  constructor(ttl = 3600000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }
}

const videoDetailsCache = new CacheWithTTL();

// Function to extract video ID from URL
function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
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

// Enhanced video details fetching with retry mechanism
async function getVideoDetails(url, maxRetries = 3) {
  try {
    if (!url) return null;

    const videoId = extractVideoId(url);
    if (!videoId) return null;

    // Check cache first
    const cachedDetails = videoDetailsCache.get(videoId);
    if (cachedDetails) return cachedDetails;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
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

        if (response.data.items?.[0]) {
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
            genre: extractGenreFromTags(video.snippet.tags || []),
            mood: analyzeMoodFromTitle(video.snippet.title),
            popularity: calculatePopularityScore(video.statistics),
          };

          videoDetailsCache.set(videoId, details);
          return details;
        }
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt))
        );
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching video details:", error);
    return null;
  }
}

// Helper functions for analysis
function extractGenreFromTags(tags) {
  const commonGenres = [
    "pop",
    "rock",
    "hip hop",
    "jazz",
    "classical",
    "electronic",
    "r&b",
    "country",
  ];
  return (
    tags.find((tag) =>
      commonGenres.some((genre) => tag.toLowerCase().includes(genre))
    ) || "unknown"
  );
}

function analyzeMoodFromTitle(title) {
  for (const [mood, patterns] of Object.entries(MOOD_PATTERNS)) {
    if (
      patterns.keywords.some((keyword) => title.toLowerCase().includes(keyword))
    ) {
      return mood;
    }
  }
  return "NEUTRAL";
}

function calculatePopularityScore(statistics) {
  const views = parseInt(statistics.viewCount) || 0;
  const likes = parseInt(statistics.likeCount) || 0;
  return (views * 0.7 + likes * 0.3) / 1000000; // Normalized score
}

async function getQueueDetails(songQueue) {
  try {
    if (!Array.isArray(songQueue)) return [];

    const details = await Promise.all(
      songQueue.map(async (url, index) => {
        try {
          if (!url) return `เพลงที่ ${index + 1}`;

          const videoDetails = await getVideoDetails(url);
          if (videoDetails) {
            return {
              title: videoDetails.title,
              artist: videoDetails.channel,
              genre: videoDetails.genre || "unknown",
              mood: videoDetails.mood || "NEUTRAL",
              popularity: videoDetails.popularity || 0,
              duration: videoDetails.duration || "unknown",
              viewCount: videoDetails.viewCount || 0,
              likeCount: videoDetails.likeCount || 0,
            };
          }
          return `เพลงที่ ${index + 1} (ไม่สามารถโหลดข้อมูลได้)`;
        } catch (error) {
          console.error("Error getting video details:", error);
          return `เพลงที่ ${index + 1} (เกิดข้อผิดพลาด)`;
        }
      })
    );

    return details.map((song) =>
      typeof song === "string" ? song : `${song.title} โดย ${song.artist}`
    );
  } catch (error) {
    console.error("Error in getQueueDetails:", error);
    return [];
  }
}

async function chatWithAI(messages, currentSong, songQueue) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("Gemini API key is not configured");
      throw new Error("Gemini API key is not configured");
    }

    if (
      !Array.isArray(messages) ||
      messages.some((msg) => !msg.role || !msg.content)
    ) {
      return "ประวัติการสนทนาไม่ถูกต้อง";
    }
    console.log("API key found, validating messages");

    // Get enhanced song details
    let currentSongDetails = await getEnhancedSongDetails(currentSong);
    const queueDetails = await getQueueDetails(songQueue);
    const conversationHistory = analyzeConversationHistory(messages);

    // Build context
    const context = buildEnhancedContext(
      currentSongDetails,
      queueDetails,
      conversationHistory,
      messages
    );

    // Generate AI response
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: context }] }],
    });
    const response = result.response?.text();

    if (!response) throw new Error("Invalid AI response");

    // Process and enhance response
    return processEnhancedResponse(
      response,
      currentSongDetails,
      conversationHistory
    );
  } catch (error) {
    console.error("Error in chatWithAI:", error);
    
    // ส่งข้อความ fallback กลับไป
    if (error.message && error.message.includes("404")) {
      return "ขออภัย ระบบ AI ไม่สามารถใช้งานได้ในขณะนี้ โปรดลองอีกครั้งในภายหลัง หรือติดต่อผู้ดูแลระบบ";
    }
    
    return "ขออภัย เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง";
  }
}

// Helper function for enhanced song details
async function getEnhancedSongDetails(currentSong) {
  if (!currentSong) return null;

  let songDetails = await getVideoDetails(
    currentSong.url || currentSong.videoUrl
  );
  if (!songDetails) return currentSong;

  return {
    ...currentSong,
    ...songDetails,
    recommendations: await generateRecommendations(songDetails),
  };
}

// Generate music recommendations
async function generateRecommendations(songDetails) {
  if (!songDetails) return [];

  const genre = songDetails.genre;
  const mood = songDetails.mood;

  const relatedGenres = GENRE_RECOMMENDATIONS.get(genre) || [];
  const moodPatterns = MOOD_PATTERNS[mood]?.searchTerms || [];

  return {
    byGenre: relatedGenres,
    byMood: moodPatterns,
    popular: songDetails.popularity > 50,
  };
}

// Analyze conversation history
function analyzeConversationHistory(messages) {
  const recentMessages = messages.slice(-5);
  const userPreferences = {
    genres: new Set(),
    moods: new Set(),
    interactions: [],
  };

  recentMessages.forEach((msg) => {
    if (msg.role === "user") {
      // Extract preferences
      Object.entries(GENRE_RECOMMENDATIONS).forEach(([genre, _]) => {
        if (msg.content.toLowerCase().includes(genre)) {
          userPreferences.genres.add(genre);
        }
      });

      Object.entries(MOOD_PATTERNS).forEach(([mood, patterns]) => {
        if (
          patterns.keywords.some((keyword) =>
            msg.content.toLowerCase().includes(keyword)
          )
        ) {
          userPreferences.moods.add(mood);
        }
      });

      userPreferences.interactions.push({
        timestamp: Date.now(),
        content: msg.content,
      });
    }
  });

  return userPreferences;
}

// Build enhanced context for AI
function buildEnhancedContext(
  currentSongDetails,
  queueDetails,
  conversationHistory,
  messages // เพิ่มพารามิเตอร์ messages
) {
  const userMessage = messages?.[messages.length - 1]?.content || ""; // เพิ่มการตรวจสอบ optional chaining

  return `คุณเป็นผู้ช่วย AI ที่ฉลาดด้านดนตรีและเสียงเพลงและการจัดการเพลงและช่วยผู้ใช้ควบคุมการเล่นเพลง

สถานะปัจจุบัน:
${formatCurrentSongInfo(currentSongDetails)}

${formatQueueInfo(queueDetails)}

การวิเคราะห์ผู้ใช้:
${formatUserPreferences(conversationHistory)}

คำสั่งที่รองรับ:
${formatCommands()}

ให้ตอบสนองอย่างฉลาดและเป็นธรรมชาติ โดยใช้ข้อมูลบริบททั้งหมดที่มี

ถ้าผู้ใช้ต้องการค้นหาเพลง ให้ตอบกลับด้วย [SEARCH:คำค้นหา]
การค้นหาเพลงให้พิจารณาจากแนวเพลง อารมณ์เพลง และประวัติการใช้งานของผู้ใช้
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
4. หากเป็นการสอบถามเกี่ยวกับความชอบของผู้ใช้ ให้ใช้ข้อมูลจากประวัติการใช้งาน
5. หากเป็นการสนทนาทั่วไป ให้ตอบอย่างเป็นธรรมชาติ`;
}

// Format current song info
function formatCurrentSongInfo(songDetails) {
  if (!songDetails) return "ไม่มีเพลงที่กำลังเล่น";

  return `กำลังเล่น: "${songDetails.title}"
ศิลปิน: ${songDetails.channel}
แนวเพลง: ${songDetails.genre}
อารมณ์เพลง: ${songDetails.mood}
ความนิยม: ${songDetails.popularity > 50 ? "สูง" : "ปานกลาง"}
ความยาว: ${songDetails.duration}
${
  songDetails.recommendations
    ? `
เพลงแนะนำ:
- แนวเพลงใกล้เคียง: ${songDetails.recommendations.byGenre.join(", ")}
- อารมณ์เพลงใกล้เคียง: ${songDetails.recommendations.byMood.join(", ")}`
    : ""
}`;
}

// Format queue information
function formatQueueInfo(queueDetails) {
  if (!queueDetails || queueDetails.length === 0) {
    return "ไม่มีเพลงในคิว";
  }

  return `เพลงในคิว (${queueDetails.length} เพลง):
${queueDetails.map((song, index) => `${index + 1}. ${song}`).join("\n")}`;
}

// Format user preferences
function formatUserPreferences(history) {
  const preferences = [];

  if (history.genres.size > 0) {
    preferences.push(`แนวเพลงที่ชอบ: ${Array.from(history.genres).join(", ")}`);
  }

  if (history.moods.size > 0) {
    preferences.push(
      `อารมณ์เพลงที่ชอบ: ${Array.from(history.moods).join(", ")}`
    );
  }

  if (history.interactions.length > 0) {
    const recentInteraction =
      history.interactions[history.interactions.length - 1];
    preferences.push(`การโต้ตอบล่าสุด: "${recentInteraction.content}"`);
  }

  return preferences.length > 0
    ? preferences.join("\n")
    : "ยังไม่มีข้อมูลการใช้งาน";
}

// Format available commands
function formatCommands() {
  return Object.entries(COMMANDS)
    .map(
      ([_, cmd]) => `${cmd.description}
- คำสั่ง: ${cmd.patterns.join(", ")}
- ตัวอย่างประโยค: ${cmd.contextTriggers.join(", ")}`
    )
    .join("\n\n");
}

// Process enhanced AI response
function processEnhancedResponse(
  response,
  currentSongDetails,
  conversationHistory
) {
  // Process commands and searches
  const enhancedResponse = enhanceSearchTerms(
    response,
    currentSongDetails,
    conversationHistory
  );

  // Add contextual recommendations
  if (currentSongDetails && response.includes("[SEARCH:")) {
    const recommendations = generateContextualRecommendations(
      currentSongDetails,
      conversationHistory
    );
    return `${enhancedResponse}\n\nคุณอาจจะชอบ: ${recommendations}`;
  }

  return enhancedResponse;
}

// Generate contextual recommendations
function generateContextualRecommendations(currentSong, history) {
  const recommendations = [];

  // Add genre-based recommendations
  if (currentSong.genre && GENRE_RECOMMENDATIONS.has(currentSong.genre)) {
    const relatedGenres = GENRE_RECOMMENDATIONS.get(currentSong.genre);
    recommendations.push(`เพลงแนว ${relatedGenres.join(", ")}`);
  }

  // Add mood-based recommendations
  if (currentSong.mood && MOOD_PATTERNS[currentSong.mood]) {
    const moodPatterns = MOOD_PATTERNS[currentSong.mood].searchTerms;
    recommendations.push(
      moodPatterns[Math.floor(Math.random() * moodPatterns.length)]
    );
  }

  // Add recommendations based on user history
  if (history.genres.size > 0 || history.moods.size > 0) {
    const userGenres = Array.from(history.genres);
    const userMoods = Array.from(history.moods);

    if (userGenres.length > 0) {
      recommendations.push(`เพลงแนว ${userGenres.join(", ")} ที่คุณชอบ`);
    }
    if (userMoods.length > 0) {
      recommendations.push(
        `เพลง${userMoods
          .map((mood) => MOOD_PATTERNS[mood].keywords[0])
          .join(", ")}`
      );
    }
  }

  return recommendations.join(" หรือ ");
}

// Enhance search terms based on context
function enhanceSearchTerms(response, currentSong, history, queueDetails) {
  const searchMatch = response.match(/\[SEARCH:(.*?)\]/);
  if (!searchMatch) return response;

  let searchTerm = searchMatch[1].trim();
  const enhancedTerms = [];

  // Add base search term
  enhancedTerms.push(searchTerm);

  // Add genre context if available
  if (currentSong?.genre && !searchTerm.includes(currentSong.genre)) {
    enhancedTerms.push(currentSong.genre);
  } 

  // Add mood context if detected
  Object.entries(MOOD_PATTERNS).forEach(([mood, patterns]) => {
    if (
      patterns.keywords.some((keyword) =>
        searchTerm.toLowerCase().includes(keyword)
      )
    ) {
      enhancedTerms.push(...patterns.searchTerms);
    }
  });

  // Add user preference context
  if (history.genres.size > 0) {
    const preferredGenre = Array.from(history.genres)[0];
    if (!enhancedTerms.includes(preferredGenre)) {
      enhancedTerms.push(preferredGenre);
    }
  }

  // Create enhanced search term
  const enhancedSearch = enhancedTerms.join(" ");
  return response.replace(searchMatch[0], `[SEARCH:${enhancedSearch}]`);
}

module.exports = chatWithAI;
