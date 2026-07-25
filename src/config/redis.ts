import { createClient } from "redis";

const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

// Without a listener here, a dropped connection emits an unhandled
// "error" event on this EventEmitter and crashes the whole process.
client.on("error", (err) => {
  console.error("Redis client error:", err.message);
});

export default client;
