// ./chatAI.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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

module.exports = chatWithAI;