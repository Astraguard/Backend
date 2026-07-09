import { Queue, Worker, type Processor } from 'bullmq';
import { config } from './config.js';

export const QUEUE_NAMES = {
  scoreRecompute: 'score-recompute',
  registryPropagation: 'registry-propagation',
  alertDispatch: 'alert-dispatch',
  claimTracing: 'claim-tracing',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: { url: config.redis.url } });
    queues.set(name, queue);
  }
  return queue;
}

export function createWorker<T = unknown>(name: QueueName, processor: Processor<T>): Worker<T> {
  return new Worker<T>(name, processor, { connection: { url: config.redis.url } });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
}
