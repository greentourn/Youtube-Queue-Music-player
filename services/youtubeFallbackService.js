// services/youtubeFallbackService.js

class YouTubeFallbackService {
  constructor() {
    this.videoCache = new Map();
  }

  // Extract video details from URL or stored data
  extractBasicVideoInfo(url) {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;

    // Check cache first
    if (this.videoCache.has(videoId)) {
      return this.videoCache.get(videoId);
    }

    // Create basic info if not in cache
    const basicInfo = {
      videoId,
      title: `Video ${videoId}`,
      thumbnails: {
        default: {
          url: `/api/placeholder/120/90`,
          width: 120,
          height: 90,
        },
        medium: {
          url: `/api/placeholder/320/180`,
          width: 320,
          height: 180,
        },
      },
      channel: "Channel unavailable",
      description: "Video information temporarily unavailable",
    };

    // Store in cache
    this.videoCache.set(videoId, basicInfo);
    return basicInfo;
  }

  // Store video info when it's available
  cacheVideoInfo(videoId, info) {
    if (videoId && info) {
      this.videoCache.set(videoId, {
        videoId,
        title: info.title,
        thumbnails: info.thumbnails,
        channel: info.channelTitle,
        description: info.description,
      });
    }
  }

  // Extract video ID from URL
  extractVideoId(url) {
    const match = url.match(
      /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  }

  // Basic search functionality when API is unavailable
  async searchOffline(query) {
    // Return empty results with message
    return {
      results: [],
      message:
        "Search functionality temporarily unavailable. Please add videos using direct YouTube URLs.",
    };
  }
}

module.exports = YouTubeFallbackService;
