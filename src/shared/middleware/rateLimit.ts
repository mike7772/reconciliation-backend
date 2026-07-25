import rateLimit from "express-rate-limit";

const env = process.env.NODE_ENV || "dev";
const rateLimitRequest = Number(process.env.RATE_LIMIT_TIME) || 100;
const rateLimitTime = Number(process.env.RATE_LIMIT_REQUEST) || 100;

export default () => {
  if (env === "production") {
    return rateLimit({
      windowMs: rateLimitTime * 60 * 1000, // 15 minutes
      max: rateLimitRequest, // limit each IP to 30 requests per windowMs
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, //
      // handler: "Rate limt exceeded, please try again later some time.",
    });
  }
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3000, // limit each IP to 3000 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, //
    // handler: "Rate limt exceeded, please try again later some time.",
  });
};