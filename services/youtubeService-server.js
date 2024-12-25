const axios = require('axios');

class YouTubeService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async getVideoInfo(videoId, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.apiKey}&part=snippet`;
        const response = await axios.get(url);
        if (response.data.items && response.data.items.length > 0) {
          return response.data.items[0].snippet;
        }
        throw new Error('Video not found');
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  async searchVideos(query, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        // เพิ่ม logging เพื่อ debug
        console.log(`Attempting YouTube search (attempt ${i + 1}/${retries})`);
        console.log(`Query: ${query}`);

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
            // เพิ่ม timeout และ headers
            timeout: 5000,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        // เพิ่ม logging สำหรับ response
        if (response.data.items?.length) {
          console.log(`Found ${response.data.items.length} results`);
        }
        return response.data.items.map((item) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.medium.url,
          channel: item.snippet.channelTitle,

          // const filteredItems = response.data.items.filter((item, index) => {
          //   const duration =
          //     detailsResponse.data.items[index].contentDetails.duration;
          //   const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
          //   if (!match) return false; // Skip if duration format is not matched
          //   const hours = parseInt(match[1]) || 0;
          //   const minutes = parseInt(match[2]) || 0;
          //   const seconds = parseInt(match[3]) || 0;
          //   const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          //   return totalSeconds <= 1200; // Filter videos shorter than or equal to 20 minutes
          // });

          // return filteredItems.map((item) => ({
          //   id: item.id.videoId,
          //   title: item.snippet.title,
          //   thumbnail: item.snippet.thumbnails.medium.url,
          //   channel: item.snippet.channelTitle,
          // }));
        }));
      } catch (error) {
        // เพิ่ม detailed error logging
        console.error("YouTube API Error:", {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });

        if (i === retries - 1) throw error;
        // เพิ่ม exponential backoff
        const delay = Math.min(1000 * Math.pow(2, i), 5000);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  async getPlaylistItems(playlistId, videoId) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${this.apiKey}`;
      const response = await axios.get(url);

      let startIndex = response.data.items.findIndex(
        item => item.snippet.resourceId.videoId === videoId
      );

      if (startIndex === -1) startIndex = 0;

      return [
        ...response.data.items.slice(startIndex),
        ...response.data.items.slice(0, startIndex)
      ].map(item => `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`);
    } catch (error) {
      console.error('Error fetching playlist:', error);
      throw error;
    }
  }
}

module.exports = YouTubeService;