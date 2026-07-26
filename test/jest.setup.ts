import { config } from "dotenv";

config();
config({ path: ".env.test", override: true });
