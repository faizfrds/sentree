import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export class RedisWatcherState {
  private client: Redis;

  constructor() {
    this.client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('connect', () => console.log('[Redis] Connected'));
    this.client.on('error', (err) => console.error('[Redis] Error:', err));
  }

  async getAreaHistory(aoi_id: string) {
    const data = await this.client.get(`area:${aoi_id}`);
    return data ? JSON.parse(data) : null;
  }

  async setAreaHistory(aoi_id: string, data: any) {
    await this.client.set(`area:${aoi_id}`, JSON.stringify(data));
    console.log(`[Redis] Updated history for ${aoi_id}`);
  }

  async addToWatchlist(userId: string, aoi_coords: any) {
    const entry = JSON.stringify({ coords: aoi_coords, timestamp: new Date().toISOString() });
    await this.client.rpush(`watchlist:${userId}`, entry);
    console.log(`[Redis] Added coords to watchlist for user ${userId}`);
  }
}
