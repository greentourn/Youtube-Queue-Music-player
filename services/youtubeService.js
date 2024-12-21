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
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          params: {
            part: 'snippet',
            q: query,
            type: 'video',
            videoCategoryId: '10',
            maxResults: 5,
            key: this.apiKey
          }
        });
        return response.data.items.map(item => ({
          id: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.medium.url,
          channel: item.snippet.channelTitle
        }));
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
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