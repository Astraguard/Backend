import { db } from '../shared/db.js';
import type { SignalValues } from './signals.js';

export interface ScoreRecord {
  subjectAddress: string;
  score: number;
  signals: SignalValues;
  recordedAt: Date;
}

export async function recordScore(record: Omit<ScoreRecord, 'recordedAt'>): Promise<void> {
  await db('score_history').insert({
    subject_address: record.subjectAddress,
    score: record.score,
    signals: JSON.stringify(record.signals),
    recorded_at: new Date(),
  });

  await db('projects')
    .where({ issuer_address: record.subjectAddress })
    .update({ latest_score: record.score, updated_at: new Date() });
}

export async function latestScore(subjectAddress: string): Promise<ScoreRecord | null> {
  const row = await db('score_history')
    .where({ subject_address: subjectAddress })
    .orderBy('recorded_at', 'desc')
    .first();

  if (!row) return null;

  return {
    subjectAddress: row.subject_address,
    score: Number(row.score),
    signals: row.signals,
    recordedAt: row.recorded_at,
  };
}

export async function scoreSeries(
  subjectAddress: string,
  since: Date,
): Promise<ScoreRecord[]> {
  const rows = await db('score_history')
    .where({ subject_address: subjectAddress })
    .where('recorded_at', '>=', since)
    .orderBy('recorded_at', 'asc');

  return rows.map((row) => ({
    subjectAddress: row.subject_address,
    score: Number(row.score),
    signals: row.signals,
    recordedAt: row.recorded_at,
  }));
}
