const axios = require('axios');

class YouTubeService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async getVideoInfo(videoId) {
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${this.apiKey}&part=snippet`;
    try {
      const response = await axios.get(url);
      return response.data.items[0].snippet;
    } catch (error) {
      console.error('Error getting video info:', error);
      throw new Error('Error retrieving video details');
    }
  }

  async searchVideos(query) {
    try {
      console.log('Searching YouTube for:', query);
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

      if (!response.data.items || response.data.items.length === 0) {
        console.log('No results found');
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