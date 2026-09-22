import type { JobStage, JobStatus } from "@irancaption/shared";

export type TranscriptionQueueMessage = {
  jobId: string;
  userId: string;
  videoId: string;
  stage: JobStage;
  status: JobStatus;
  attempt: number;
  requestId: string;
};

export async function enqueueJob(queue: Queue, message: TranscriptionQueueMessage): Promise<void> {
  await queue.send(message, { contentType: "json" });
}
