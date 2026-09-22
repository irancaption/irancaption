import "./styles.css";
import { browserSupportsPasskeys, startAuthentication, startRegistration } from "@simplewebauthn/browser";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Application root was not found.");

app.innerHTML = `
  <section class="shell">
    <div class="card" aria-labelledby="page-title">
      <div class="brand-mark" aria-hidden="true">AI</div>
      <p class="eyebrow">پلتفرم زیرنویس هوشمند</p>
      <h1 id="page-title">Persian Subtitle AI</h1>
      <p class="intro">ویدئوی خود را بارگذاری کنید و زیرنویس فارسی را با کمک هوش مصنوعی دریافت کنید.</p>
      <div class="actions">
        <button class="primary" type="button" id="passkey-button">ورود با Passkey</button>
        <button class="secondary" type="button" id="register-button">ساخت Passkey</button>
        <button class="secondary" type="button" id="upload-button">انتخاب ویدئو</button>
      </div>
      <input id="video-input" type="file" accept="video/mp4,.mp4" hidden />
      <p class="status" id="status" role="status" aria-live="polite">در حال بررسی پشتیبانی Passkey…</p>
    </div>
  </section>
`;

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const passkeyButton = document.querySelector<HTMLButtonElement>("#passkey-button")!;
const registerButton = document.querySelector<HTMLButtonElement>("#register-button")!;
const uploadButton = document.querySelector<HTMLButtonElement>("#upload-button")!;
const videoInput = document.querySelector<HTMLInputElement>("#video-input")!;

function message(value: string) { status.textContent = value; }

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/v1${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
}

async function login() {
  if (!browserSupportsPasskeys()) { message("این مرورگر از Passkey پشتیبانی نمی‌کند."); return; }
  passkeyButton.disabled = true;
  try {
    const optionsResponse = await api("/auth/passkey/login/options", { method: "POST", body: "{}" });
    if (!optionsResponse.ok) throw new Error("دریافت گزینه‌های ورود ناموفق بود.");
    const authentication = await startAuthentication({ optionsJSON: await optionsResponse.json() });
    const verify = await api("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify(authentication) });
    if (!verify.ok) throw new Error("احراز هویت Passkey ناموفق بود.");
    message("ورود با موفقیت انجام شد.");
  } catch (error) { message(error instanceof Error ? error.message : "ورود ناموفق بود."); }
  finally { passkeyButton.disabled = false; }
}

async function register() {
  if (!browserSupportsPasskeys()) { message("این مرورگر از Passkey پشتیبانی نمی‌کند."); return; }
  registerButton.disabled = true;
  try {
    const optionsResponse = await api("/auth/passkey/register/options", { method: "POST", body: "{}" });
    if (!optionsResponse.ok) throw new Error("دریافت گزینه‌های ثبت Passkey ناموفق بود.");
    const registration = await startRegistration({ optionsJSON: await optionsResponse.json() });
    const verify = await api("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify(registration) });
    if (!verify.ok) throw new Error("ثبت Passkey ناموفق بود.");
    message("Passkey ساخته شد و ورود شما انجام شد.");
  } catch (error) { message(error instanceof Error ? error.message : "ثبت Passkey ناموفق بود."); }
  finally { registerButton.disabled = false; }
}

passkeyButton.addEventListener("click", login);
registerButton.addEventListener("click", register);
uploadButton.addEventListener("click", () => videoInput.click());
videoInput.addEventListener("change", () => { void uploadSelectedVideo(videoInput.files?.[0] ?? null); });

async function uploadSelectedVideo(file: File | null) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".mp4") || file.type !== "video/mp4") { message("فقط فایل MP4 مجاز است."); return; }
  if (file.size <= 0 || file.size > 100 * 1024 * 1024) { message("حجم ویدئو باید حداکثر 100 مگابایت باشد."); return; }
  message("در حال بررسی مدت ویدئو…");
  const durationMs = await readVideoDuration(file);
  if (durationMs === null) { message("امکان خواندن مدت ویدئو وجود ندارد."); return; }
  if (durationMs > 30 * 60 * 1000) { message("مدت ویدئو نباید بیشتر از 30 دقیقه باشد."); return; }

  uploadButton.disabled = true;
  try {
    const session = await api("/auth/passkey/session");
    const sessionData = await session.json() as { authenticated?: boolean };
    if (!sessionData.authenticated) { message("ابتدا با Passkey وارد شوید."); return; }

    message("در حال آماده‌سازی آپلود امن…");
    const create = await api("/uploads", { method: "POST", body: JSON.stringify({ filename: file.name, mimeType: "video/mp4", fileSize: file.size }) });
    if (!create.ok) throw new Error("ایجاد نشست آپلود ناموفق بود.");
    const upload = await create.json() as { uploadId: string; videoId: string; uploadUrl: string; headers: { "Content-Type": string } };
    message("در حال آپلود مستقیم ویدئو به R2…");
    const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file });
    if (!put.ok) throw new Error("آپلود ویدئو ناموفق بود.");
    const complete = await api(`/uploads/${encodeURIComponent(upload.uploadId)}/complete`, { method: "POST", body: "{}" });
    if (!complete.ok) throw new Error("تأیید آپلود ویدئو ناموفق بود.");

    message("در حال استخراج صوت در مرورگر…");
    const audio = await extractAudio(file);
    message("در حال ایجاد آپلود صوتی امن…");
    const audioCreate = await api(`/videos/${encodeURIComponent(upload.videoId)}/audio-upload`, { method: "POST", body: JSON.stringify({ mimeType: audio.type, fileSize: audio.size }) });
    if (!audioCreate.ok) throw new Error("ایجاد نشست آپلود صوت ناموفق بود.");
    const audioUpload = await audioCreate.json() as { uploadUrl: string; headers: { "Content-Type": string } };
    const audioPut = await fetch(audioUpload.uploadUrl, { method: "PUT", headers: audioUpload.headers, body: audio });
    if (!audioPut.ok) throw new Error("آپلود صوت ناموفق بود.");
    const audioComplete = await api(`/videos/${encodeURIComponent(upload.videoId)}/audio-upload/complete`, { method: "POST", body: "{}" });
    if (!audioComplete.ok) throw new Error("تأیید صوت ناموفق بود.");

    message("در حال ثبت پردازش هوش مصنوعی…");
    const job = await api(`/videos/${encodeURIComponent(upload.videoId)}/process`, { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
    if (!job.ok) throw new Error("ثبت پردازش ویدئو ناموفق بود.");
    message("ویدئو در صف پردازش زیرنویس فارسی قرار گرفت.");
  } catch (error) { message(error instanceof Error ? error.message : "پردازش ویدئو ناموفق بود."); }
  finally { uploadButton.disabled = false; videoInput.value = ""; }
}

function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { const duration = Number.isFinite(video.duration) ? video.duration * 1000 : null; URL.revokeObjectURL(url); video.remove(); resolve(duration); };
    video.onerror = () => { URL.revokeObjectURL(url); video.remove(); resolve(null); };
    video.src = url;
  });
}

async function extractAudio(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  document.body.appendChild(video);
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("فایل ویدئو قابل رمزگشایی نیست."));
    });
    const capture = video.captureStream?.();
    if (!capture) throw new Error("مرورگر امکان استخراج صوت را فراهم نمی‌کند. از Chrome یا Edge استفاده کنید.");
    const audioTracks = capture.getAudioTracks();
    if (audioTracks.length === 0) throw new Error("این ویدئو ترک صوتی ندارد.");
    const stream = new MediaStream(audioTracks);
    const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const mimeType = mimeTypes.find((value) => MediaRecorder.isTypeSupported(value));
    if (!mimeType) throw new Error("مرورگر از خروجی صوتی موردنیاز پشتیبانی نمی‌کند.");
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 });
    const chunks: BlobPart[] = [];
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("استخراج صوت ناموفق بود."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });
    video.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
    recorder.start(1000);
    await video.play();
    const blob = await finished;
    stream.getTracks().forEach((track) => track.stop());
    if (blob.size === 0) throw new Error("صوت استخراج‌شده خالی است.");
    return blob;
  } finally {
    video.pause();
    video.remove();
    URL.revokeObjectURL(url);
  }
}

void api("/auth/passkey/session").then(async (response) => {
  if (!response.ok) return;
  const data = await response.json() as { authenticated?: boolean };
  if (data.authenticated) message("شما وارد شده‌اید. آماده دریافت ویدئو هستید.");
  else if (browserSupportsPasskeys()) message("برای شروع، با Passkey وارد شوید یا یک Passkey بسازید.");
  else message("این مرورگر از Passkey پشتیبانی نمی‌کند.");
}).catch(() => message("برای شروع، با Passkey وارد شوید یا یک Passkey بسازید."));
