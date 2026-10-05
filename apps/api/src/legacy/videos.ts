import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// ---------------------------------------------------------------------------
// Vidéos lisibles partout : MP4 en H.264 (+ AAC). Les vidéos d'iPhone sont
// souvent en HEVC (H.265) : lues par les téléphones, mais image noire avec le
// son dans Chrome sous Windows. ffmpeg (installé sur le poste) les convertit.
// ---------------------------------------------------------------------------

const run = promisify(execFile);

/** Codec vidéo (« h264 », « hevc »…) d'un fichier ou d'une adresse, ou null si illisible. */
export async function videoCodec(source: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", source],
      { timeout: 120_000 },
    );
    return stdout.trim().replace(/,+$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Rend une vidéo lisible partout. Déjà en H.264 dans un MP4 : renvoyée telle
 * quelle. H.264 dans un .mov : simple changement d'enveloppe (sans perte).
 * Autre codec (HEVC…) : réencodée en H.264, 720p au plus, son AAC.
 * null si ffmpeg est absent ou la vidéo illisible.
 */
export async function normalizeVideo(input: Buffer, mime: string | null): Promise<{ buffer: Buffer; changed: boolean } | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reprise-video-"));
  const src = path.join(dir, `${randomUUID()}${mime === "video/quicktime" ? ".mov" : ".mp4"}`);
  const out = path.join(dir, `${randomUUID()}.mp4`);
  try {
    await fs.writeFile(src, input);
    const codec = await videoCodec(src);
    if (!codec) return null;
    if (codec === "h264" && mime === "video/mp4") return { buffer: input, changed: false };
    const args =
      codec === "h264"
        ? ["-c", "copy"]
        : ["-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k"];
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, ...args, "-movflags", "+faststart", out], { timeout: 900_000 });
    return { buffer: await fs.readFile(out), changed: true };
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
