const axios = require("axios");
const YouTubeFallbackService = require("./youtubeFallbackService");

class YouTubeService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.fallbackService = new YouTubeFallbackService();
    this.isQuotaExceeded = false;
  }

  async getVideoInfo(videoId, retries = 3) {
    // If we know quota is exceeded, use fallback immediately
    if (this.isQuotaExceeded) {
      return this.fallbackService.extractBasicVideoInfo(
        `https://youtube.com/watch?v=${videoId}`
      );
    }

    for (let i = 0; i < retries; i++) {
      try {
        const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.apiKey}&part=snippet`;
        const response = await axios.get(url);

        if (response.data.items && response.data.items.length > 0) {
          const videoInfo = response.data.items[0].snippet;
          // Cache the info for fallback
          this.fallbackService.cacheVideoInfo(videoId, videoInfo);
          return videoInfo;
        }
        throw new Error("Video not found");
      } catch (error) {
        if (error.response?.status === 403 || error.response?.status === 429) {
          this.isQuotaExceeded = true;
          return this.fallbackService.extractBasicVideoInfo(
            `https://youtube.com/watch?v=${videoId}`
          );
        }
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  async searchVideos(query, retries = 3) {
    // If quota exceeded, return message about using direct URLs
    if (this.isQuotaExceeded) {
      return this.fallbackService.searchOffline(query);
    }

    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(
          "https://www.googleapis.com/youtube/v3/search",
          {
            params: {
              part: "snippet",
              q: query,
              type: "video",
              videoCategoryId: "10",
              maxResults: 5,
              key: this.apiKey,
            },
            timeout: 5000,
          }
        );

        return response.data.items.map((item) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.medium.url,
          channel: item.snippet.channelTitle,
        }));
      } catch (error) {
        if (error.response?.status === 403 || error.response?.status === 429) {
          this.isQuotaExceeded = true;
          return this.fallbackService.searchOffline(query);
        }

        if (i === retries - 1) throw error;
        const delay = Math.min(1000 * Math.pow(2, i), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async getPlaylistItems(playlistId, videoId) {
    if (this.isQuotaExceeded) {
      return [videoId]; // Return only the original video in fallback mode
    }

    try {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${this.apiKey}`;
      const response = await axios.get(url);

      let startIndex = response.data.items.findIndex(
        (item) => item.snippet.resourceId.videoId === videoId
      );

      if (startIndex === -1) startIndex = 0;

      return [
        ...response.data.items.slice(startIndex),
        ...response.data.items.slice(0, startIndex),
      ].map(
        (item) =>
          `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`
      );
    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 429) {
        this.isQuotaExceeded = true;
        return [videoId];
      }
      throw error;
    }
  }
}

module.exports = YouTubeService;
