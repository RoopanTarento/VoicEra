import { apiFetch, apiFetchBlob } from "@/lib/api/http";
import type {
  CampaignAnalyticsResponse,
  CampaignApiResponse,
  ObdCampaignStatusResponse,
  ObdReportResponse,
  CampaignCsvUploadResponse,
  CampaignProgressResponse,
  CampaignRunItem,
  CampaignRunsListResponse,
  CreateCampaignPayload,
} from "@/lib/api-types";

export async function listCampaigns(): Promise<CampaignApiResponse[]> {
  return apiFetch<CampaignApiResponse[]>("/campaign/");
}

export async function getCampaign(campaignId: string): Promise<CampaignApiResponse> {
  return apiFetch<CampaignApiResponse>(`/campaign/${encodeURIComponent(campaignId)}`);
}

/** CSV only — returns a source_id to pass straight through to createCampaign. */
export async function uploadCampaignCsv(file: File): Promise<CampaignCsvUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<CampaignCsvUploadResponse>("/campaign/upload", {
    method: "POST",
    body: formData,
  });
}

export async function createCampaign(payload: CreateCampaignPayload): Promise<CampaignApiResponse> {
  return apiFetch<CampaignApiResponse>("/campaign/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startCampaign(campaignId: string): Promise<{ status: string; campaign_id: string }> {
  return apiFetch(`/campaign/${encodeURIComponent(campaignId)}/start`, { method: "POST" });
}

export async function pauseCampaign(campaignId: string): Promise<{ status: string; campaign_id: string }> {
  return apiFetch(`/campaign/${encodeURIComponent(campaignId)}/pause`, { method: "POST" });
}

export async function resumeCampaign(campaignId: string): Promise<{ status: string; campaign_id: string }> {
  return apiFetch(`/campaign/${encodeURIComponent(campaignId)}/resume`, { method: "POST" });
}

export async function redialCampaign(campaignId: string, name: string): Promise<CampaignApiResponse> {
  return apiFetch<CampaignApiResponse>(`/campaign/${encodeURIComponent(campaignId)}/redial`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** A new, not-yet-started campaign with the same agent, list and settings.
 * Without a name the API calls it "<name> (copy)", "(copy 2)" … */
export async function duplicateCampaign(campaignId: string, name?: string): Promise<CampaignApiResponse> {
  return apiFetch<CampaignApiResponse>(`/campaign/${encodeURIComponent(campaignId)}/duplicate`, {
    method: "POST",
    body: JSON.stringify(name ? { name } : {}),
  });
}

export async function deleteCampaign(campaignId: string): Promise<{ status: string; message: string }> {
  return apiFetch(`/campaign/${encodeURIComponent(campaignId)}`, { method: "DELETE" });
}

export type CampaignRunsQuery = {
  limit?: number;
  offset?: number;
  status?: string;
  call_response?: string;
  created_after?: string;
  created_before?: string;
};

export async function getCampaignRuns(
  campaignId: string,
  params: CampaignRunsQuery = {},
): Promise<CampaignRunsListResponse> {
  const q = new URLSearchParams();
  q.set("limit", String(params.limit ?? 50));
  q.set("offset", String(params.offset ?? 0));
  if (params.status) q.set("status", params.status);
  if (params.call_response) q.set("call_response", params.call_response);
  if (params.created_after) q.set("created_after", params.created_after);
  if (params.created_before) q.set("created_before", params.created_before);
  return apiFetch<CampaignRunsListResponse>(
    `/campaign/${encodeURIComponent(campaignId)}/runs?${q.toString()}`,
  );
}

/** Page through every call for a campaign (exports / bulk downloads). */
export async function listAllCampaignRuns(
  campaignId: string,
  filters: Omit<CampaignRunsQuery, "limit" | "offset"> = {},
  pageSize = 100,
): Promise<CampaignRunItem[]> {
  const all: CampaignRunItem[] = [];
  let offset = 0;
  for (;;) {
    const res = await getCampaignRuns(campaignId, {
      ...filters,
      limit: pageSize,
      offset,
    });
    all.push(...res.calls);
    offset += res.calls.length;
    if (res.calls.length === 0 || offset >= res.total) break;
  }
  return all;
}

export async function getCampaignProgress(campaignId: string): Promise<CampaignProgressResponse> {
  return apiFetch<CampaignProgressResponse>(
    `/campaign/${encodeURIComponent(campaignId)}/progress`,
  );
}

export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalyticsResponse> {
  return apiFetch<CampaignAnalyticsResponse>(
    `/campaign/${encodeURIComponent(campaignId)}/analytics`,
  );
}

export async function getObdReport(campaignId: string): Promise<ObdReportResponse> {
  return apiFetch<ObdReportResponse>(
    `/campaign/${encodeURIComponent(campaignId)}/obd-report`,
  );
}

export async function downloadObdReport(campaignId: string): Promise<Blob> {
  return apiFetchBlob(
    `/campaign/${encodeURIComponent(campaignId)}/obd-report?format=zip`,
  );
}

export async function getObdStatus(campaignId: string): Promise<ObdCampaignStatusResponse> {
  return apiFetch<ObdCampaignStatusResponse>(
    `/campaign/${encodeURIComponent(campaignId)}/obd-status`,
  );
}

export async function downloadCampaignReport(
  campaignId: string,
  opts: { created_after?: string; created_before?: string } = {},
): Promise<Blob> {
  const q = new URLSearchParams();
  if (opts.created_after) q.set("created_after", opts.created_after);
  if (opts.created_before) q.set("created_before", opts.created_before);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetchBlob(`/campaign/${encodeURIComponent(campaignId)}/report${suffix}`);
}

export interface CampaignAnalytics {
  campaign_id: string;
  name?: string | null;
  state?: string | null;
  contacts_total: number;
  contacts_processed: number;
  calls_attempted: number;
  calls_answered: number;
  answer_rate: number;
  avg_duration_seconds: number | null;
  total_talk_minutes: number;
  interested: number;
  interest_rate: number;
  call_responses: { key: string; count: number }[];
  outcomes: { key: string; label: string; count: number }[];
  sentiments: { key: "positive" | "neutral" | "negative"; count: number }[];
  feedback_themes: { code: string; text: string; calls: number }[];
  analysed_calls: number;
  analysis_engines: Record<string, number>;
  /** Calls whose transcript was made up by the mock provider (not real conversations). */
  synthetic_transcripts: number;
  /** The scheme agent's intent (awareness, support…); null for city surveys and free-form agents. */
  intent?: string | null;
  /** Calls where the person reported a problem (support and utilisation agents). */
  issues_reported?: number;
  /** Problem types reported, most common first. */
  issues?: { theme: string; calls: number }[];
  /** Calls that switched to another intent's path, by intent. */
  switched_paths?: { intent: string; calls: number }[];
  /** Per-question results when the campaign's agent runs a survey (city or scheme feedback); null otherwise. */
  survey: CampaignSurveyResults | null;
}

export interface CampaignSurveyResults {
  survey_id: string;
  name: string;
  responses: number;
  completed: number;
  questions: {
    id: string;
    text: string;
    kind: "rating" | "yes_no" | "open";
    answered: number;
    average?: number | null;
    distribution?: Record<string, number>;
    yes_percent?: number | null;
  }[];
  themes: { theme: string; calls: number }[];
}

/**
 * Campaign results (outcomes, sentiment, survey, issues) for the Results view.
 * Same `/campaign/{id}/analytics` route as `getCampaignAnalytics` above: the API
 * returns the progress/connection stats and these results fields together.
 */
export async function getCampaignResultsAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  return apiFetch<CampaignAnalytics>(`/campaign/${encodeURIComponent(campaignId)}/analytics`);
}

/** One campaign's numbers in a period (Analysis tab). */
export interface PeriodCampaign {
  campaign_id: string;
  name: string;
  state?: string | null;
  agent_id?: string | null;
  calls: number;
  answered: number;
  answer_rate: number;
  issues_reported: number;
  avg_duration_seconds: number | null;
  top_outcome: { key: string; label: string; calls: number } | null;
  days_active: number;
  first_call: string;
  last_call: string;
}

export interface PeriodDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  calls: number;
  answered: number;
  answer_rate: number;
  campaigns: { campaign_id: string; name: string; calls: number }[];
}

/** Campaign analysis for a period of local days (both inclusive). */
export interface CampaignInsights {
  from: string;
  to: string;
  tz: string;
  totals: {
    campaigns: number;
    calls: number;
    answered: number;
    answer_rate: number;
    avg_duration_seconds: number | null;
    talk_minutes: number;
    interested: number;
    issues_reported: number;
    switched_path: number;
    days_active: number;
  };
  outcomes: { key: string; label: string; count: number }[];
  issues: { theme: string; calls: number }[];
  /** Only days with calls, oldest first. */
  days: PeriodDay[];
  /** 24 buckets, local hour. */
  hours: { hour: number; calls: number; answered: number }[];
  campaigns: PeriodCampaign[];
  /** True when the period had more calls than the API summarises at once. */
  truncated: boolean;
}

export async function getCampaignInsights(params: {
  from: string;
  to: string;
  campaignId?: string;
  agentId?: string;
}): Promise<CampaignInsights> {
  const q = new URLSearchParams({ from: params.from, to: params.to, tz: "Asia/Kolkata" });
  if (params.campaignId) q.set("campaign_id", params.campaignId);
  if (params.agentId) q.set("agent_id", params.agentId);
  return apiFetch<CampaignInsights>(`/campaign/insights?${q}`);
}
