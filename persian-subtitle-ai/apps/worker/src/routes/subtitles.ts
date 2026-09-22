import { Hono } from "hono";
import { formatSrt, formatVtt } from "@irancaption/subtitle-core";
import type { Bindings } from "../index.js";
import { requireSession, type AuthVariables } from "../auth/sessions/middleware.js";
import { HttpApiError, apiError } from "../errors/api.js";
import { writeAudit } from "../audit/log.js";
import { validateSubtitleDocument, type SubtitleCue } from "@irancaption/subtitle-core";
import { z } from "zod";

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables & { requestId: string } }>();
app.use("/*", requireSession);

async function loadSubtitle(db: D1Database, subtitleId: string, userId: string) {
  const subtitle = await db.prepare("SELECT id, video_id, language, current_version_id, created_at, updated_at FROM subtitles WHERE id = ? AND user_id = ? LIMIT 1").bind(subtitleId, userId).first<{ id: string; video_id: string; language: string; current_version_id: string | null; created_at: string; updated_at: string }>();
  if (!subtitle) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Subtitle was not found.");
  return subtitle;
}

async function loadCues(db: D1Database, versionId: string) {
  const rows = await db.prepare("SELECT sequence, start_ms, end_ms, text, speaker FROM subtitle_cues WHERE version_id = ? ORDER BY sequence ASC").bind(versionId).all<{ sequence: number; start_ms: number; end_ms: number; text: string; speaker: string | null }>();
  return rows.results.map((cue) => ({ sequence: cue.sequence, startMs: cue.start_ms, endMs: cue.end_ms, text: cue.text, ...(cue.speaker ? { speaker: cue.speaker } : {}) }));
}


const cueSchema = z.object({ sequence: z.number().int().positive(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string().trim().min(1).max(2000), speaker: z.string().trim().max(200).optional() });
const documentSchema = z.object({ cues: z.array(cueSchema).max(5000) });

async function createVersion(db: D1Database, subtitleId: string, userId: string, cues: SubtitleCue[], source: "user" | "import"): Promise<string> {
  const normalized = validateSubtitleDocument({ language: "fa", cues });
  const latest = await db.prepare("SELECT COALESCE(MAX(version_number),0) AS version_number FROM subtitle_versions WHERE subtitle_id = ?").bind(subtitleId).first<{version_number:number}>();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const versionNumber = (latest?.version_number ?? 0) + 1;
  await db.prepare("INSERT INTO subtitle_versions (id,subtitle_id,version_number,source,created_by,created_at) VALUES (?,?,?,?,?,?)").bind(versionId,subtitleId,versionNumber,source,userId,now).run();
  const statements = normalized.cues.map(cue => db.prepare("INSERT INTO subtitle_cues (id,version_id,sequence,start_ms,end_ms,text,speaker,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),versionId,cue.sequence,cue.startMs,cue.endMs,cue.text,cue.speaker ?? null,now,now));
  for(let i=0;i<statements.length;i+=50) await db.batch(statements.slice(i,i+50));
  await db.prepare("UPDATE subtitles SET current_version_id=?,updated_at=? WHERE id=? AND user_id=?").bind(versionId,now,subtitleId,userId).run();
  return versionId;
}

app.put("/:id", async (c) => {
  const subtitle = await loadSubtitle(c.env.DB, c.req.param("id"), c.get("userId"));
  const body = documentSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HttpApiError(400,"INVALID_REQUEST","Invalid subtitle document.");
  const cues = body.data.cues as SubtitleCue[];
  try { validateSubtitleDocument({language:"fa",cues}); } catch { throw new HttpApiError(400,"INVALID_REQUEST","Subtitle timestamps or text are invalid."); }
  const versionId = await createVersion(c.env.DB, subtitle.id, c.get("userId"), cues, "user");
  await writeAudit(c.env.DB,{userId:c.get("userId"),action:"SUBTITLE_UPDATE",resourceType:"subtitle",resourceId:subtitle.id,metadata:{versionId,cueCount:cues.length}});
  return c.json({ok:true,versionId});
});

app.post("/:id/split", async (c) => {
  const subtitle = await loadSubtitle(c.env.DB,c.req.param("id"),c.get("userId"));
  if(!subtitle.current_version_id) throw new HttpApiError(404,"SUBTITLE_GENERATION_FAILED","The subtitle has no current version.");
  const body=z.object({sequence:z.number().int().positive(),atMs:z.number().int().positive()}).safeParse(await c.req.json().catch(()=>null));
  if(!body.success) throw new HttpApiError(400,"INVALID_REQUEST","Invalid split request.");
  const cues=await loadCues(c.env.DB,subtitle.current_version_id); const index=cues.findIndex(x=>x.sequence===body.data.sequence); if(index<0) throw new HttpApiError(404,"INVALID_REQUEST","Cue was not found.");
  const cue=cues[index]; if(body.data.atMs<=cue.startMs || body.data.atMs>=cue.endMs) throw new HttpApiError(400,"INVALID_REQUEST","Split point must be inside the cue.");
  const words=cue.text.trim().split(/\s+/u); if(words.length<2) throw new HttpApiError(400,"INVALID_REQUEST","Cue text must contain at least two words."); const half=Math.ceil(words.length/2);
  const next=[...cues.slice(0,index),{...cue,endMs:body.data.atMs,text:words.slice(0,half).join(" ")},{...cue,startMs:body.data.atMs,endMs:cue.endMs,text:words.slice(half).join(" ")},...cues.slice(index+1)].map((x,i)=>({...x,sequence:i+1}));
  const versionId=await createVersion(c.env.DB,subtitle.id,c.get("userId"),next,"user");
  await writeAudit(c.env.DB,{userId:c.get("userId"),action:"SUBTITLE_UPDATE",resourceType:"subtitle",resourceId:subtitle.id,metadata:{operation:"split",versionId}}); return c.json({ok:true,versionId});
});

app.post("/:id/merge", async (c) => {
  const subtitle=await loadSubtitle(c.env.DB,c.req.param("id"),c.get("userId")); if(!subtitle.current_version_id) throw new HttpApiError(404,"SUBTITLE_GENERATION_FAILED","The subtitle has no current version.");
  const body=z.object({firstSequence:z.number().int().positive(),secondSequence:z.number().int().positive()}).safeParse(await c.req.json().catch(()=>null)); if(!body.success||body.data.secondSequence!==body.data.firstSequence+1) throw new HttpApiError(400,"INVALID_REQUEST","Only adjacent cues can be merged.");
  const cues=await loadCues(c.env.DB,subtitle.current_version_id); const a=cues.findIndex(x=>x.sequence===body.data.firstSequence),b=cues.findIndex(x=>x.sequence===body.data.secondSequence); if(a<0||b!==a+1) throw new HttpApiError(404,"INVALID_REQUEST","Cues were not found.");
  const merged={...cues[a],endMs:cues[b].endMs,text:`${cues[a].text} ${cues[b].text}`.trim()}; const next=[...cues.slice(0,a),merged,...cues.slice(b+1)].map((x,i)=>({...x,sequence:i+1}));
  const versionId=await createVersion(c.env.DB,subtitle.id,c.get("userId"),next,"user"); await writeAudit(c.env.DB,{userId:c.get("userId"),action:"SUBTITLE_UPDATE",resourceType:"subtitle",resourceId:subtitle.id,metadata:{operation:"merge",versionId}}); return c.json({ok:true,versionId});
});

app.get("/", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, video_id, language, current_version_id, created_at, updated_at FROM subtitles WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100").bind(c.get("userId")).all();
  return c.json({ subtitles: rows.results });
});

app.get("/:id", async (c) => {
  const subtitle = await loadSubtitle(c.env.DB, c.req.param("id"), c.get("userId"));
  if (!subtitle.current_version_id) return c.json({ subtitle, cues: [] });
  return c.json({ subtitle, cues: await loadCues(c.env.DB, subtitle.current_version_id) });
});

app.get("/:id/export/:format", async (c) => {
  const subtitle = await loadSubtitle(c.env.DB, c.req.param("id"), c.get("userId"));
  if (!subtitle.current_version_id) throw new HttpApiError(404, "SUBTITLE_GENERATION_FAILED", "The subtitle has no current version.");
  const format = c.req.param("format").toLowerCase();
  if (format !== "srt" && format !== "vtt") throw new HttpApiError(400, "INVALID_REQUEST", "Subtitle format must be srt or vtt.");
  const cues = await loadCues(c.env.DB, subtitle.current_version_id);
  const document = { language: subtitle.language, cues };
  const body = format === "srt" ? formatSrt(document) : formatVtt(document);
  const contentType = format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8";
  await writeAudit(c.env.DB, { userId: c.get("userId"), action: "SUBTITLE_EXPORT", resourceType: "subtitle", resourceId: subtitle.id, metadata: { format } });
  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="subtitle-${subtitle.id}.${format}"`);
  return c.body(body);
});

app.onError((error, c) => error instanceof HttpApiError ? apiError(c, error) : apiError(c, new HttpApiError(500, "INTERNAL_ERROR", "Subtitle request failed.", true)));
export default app;
