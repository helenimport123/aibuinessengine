import { EventEmitter } from "events";

export type JobEvent =
  | { type: "job_queued"; taskId: number; agentType: string; agentName: string; projectId: number; projectName: string }
  | { type: "job_started"; taskId: number; agentType: string; agentName: string; projectId: number; projectName: string; workerId: string }
  | { type: "job_completed"; taskId: number; agentType: string; agentName: string; projectId: number; tokens: number; cost: number }
  | { type: "job_failed"; taskId: number; agentType: string; agentName: string; projectId: number; error: string }
  | { type: "heartbeat" };

const jobBus = new EventEmitter();
jobBus.setMaxListeners(200);

export { jobBus };

export function emitJobEvent(event: JobEvent): void {
  jobBus.emit("job", event);
}
