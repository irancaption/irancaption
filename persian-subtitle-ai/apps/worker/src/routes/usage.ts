import { Hono } from "hono";
import type { Bindings } from "../index.js";
import { requireSession, type AuthVariables } from "../auth/sessions/middleware.js";
import { getUsage, maxProcessedSeconds } from "../usage/quota.js";
const app=new Hono<{Bindings:Bindings;Variables:AuthVariables & {requestId:string}}>();
app.use("/*",requireSession);
app.get("/",async c=>c.json({usage:await getUsage(c.env.DB,c.get("userId")),limits:{maxUploadBytesPerPeriod:Number(c.env.MAX_UPLOAD_BYTES_PER_PERIOD)||1024*1024*1024,maxVideoCountPerPeriod:Number(c.env.MAX_VIDEO_COUNT_PER_PERIOD)||10,maxJobCountPerPeriod:Number(c.env.MAX_JOB_COUNT_PER_PERIOD)||20,maxProcessedSecondsPerPeriod:maxProcessedSeconds(c.env)}}));
export default app;
