export type Verdict = 'safe' | 'caution' | 'danger';

export type CoverageStatus = 'ineligible' | 'eligible' | 'active' | 'paused' | 'revoked';

export type ReportStatus = 'pending' | 'endorsed' | 'confirmed' | 'rejected';

export type ClaimStatus = 'filed' | 'in_review' | 'approved' | 'rejected' | 'paid';

export interface PageParams {
  limit: number;
  cursor?: string;
}
