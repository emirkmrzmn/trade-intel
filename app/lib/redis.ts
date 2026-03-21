import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.kv_KV_REST_API_URL!,
  token: process.env.kv_KV_REST_API_TOKEN!,
});
