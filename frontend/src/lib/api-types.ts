/** Organisation roles (see GET /rbac/roles for labels and permissions). */
export type UserRole =
  | "super_admin"
  | "admin"
  | "member"
  | "campaign_manager"
  | "agent_builder"
  | "analyst"
  | "auditor";

export interface OrganisationSummary {
  org_id: string;
  name: string;
  role: UserRole;
}

export interface LoginResponse {
  status: string;
  message: string;
  access_token: string;
  token_type: string;
  org_id: string;
  role: string;
  organisations: OrganisationSummary[];
  is_first_login?: boolean;
}

export interface UserProfile {
  email: string;
  org_id: string;
  role: UserRole;
  organisation_name?: string;
  organisations: OrganisationSummary[];
  created_at?: string;
}

export interface MemberListItem {
  email: string;
  role: UserRole;
  created_at?: string;
}

export interface MemberListResponse {
  status: string;
  members: MemberListItem[];
  count: number;
}

export interface UserOrganisationsResponse {
  status: string;
  organisations: OrganisationSummary[];
  count: number;
}

export interface CheckEmailResult {
  exists: boolean;
  already_in_org: boolean;
  can_join: boolean;
}

export interface AgentApiResponse {
  agent_id: string;
  org_id: string;
  name: string;
  status: "active" | "archived";
  archived: boolean;
  agent_category: "telephony" | "websocket";
  created_by: string;
  linked_phone_number: string | null;
  telephony: {
    provider: string;
    application_id: string;
    answer_url: string;
    hangup_url?: string | null;
  } | null;
  config: {
    schema_version: number;
    prompts: {
      system_prompt: string;
      greeting_message: string;
    };
    behaviour: Record<string, unknown>;
    language: {
      primary: string;
      secondary: string[];
    };
    models: {
      stt_config: Record<string, unknown>;
      tts_config: Record<string, unknown>;
      llm_config: Record<string, unknown>;
    };
    knowledge_base: {
      enabled: boolean;
      document_ids: string[];
      top_k: number;
    };
    custom_variables?: Record<string, string>;
    /** What the agent is for (a scheme agent with its intent, or a city survey), if picked. */
    use_case?: AgentUseCase | null;
  };
  created_at?: string;
  updated_at?: string;
}

export interface AgentCreatePayload {
  name: string;
  agent_category: "telephony" | "websocket";
  telephony_provider?: string | null;
  config: AgentApiResponse["config"];
  archived?: boolean;
}

export interface PhoneNumberItem {
  phone_number: string;
  provider: string;
  org_id: string;
  agent_id?: string | null;
  created_at?: string;
  updated_at?: string;
  last_link_action?: "attached" | "detached" | "imported" | string | null;
  last_link_agent_id?: string | null;
  last_link_by_email?: string | null;
  last_link_at?: string | null;
}

export interface PhoneNumberInventoryResponse {
  status: string;
  numbers: string[];
}

export type CallLogStatus = "initiated" | "ringing" | "failed" | "in_progress" | "completed";

export type CallType = "inbound" | "outbound" | "web";

/** What a scheme agent's calls are for. */
export type SchemeIntent = "awareness" | "discovery" | "enrolment" | "utilisation" | "support" | "feedback";

export interface AgentUseCase {
  /** Agents saved before intents existed come back as "scheme_discovery"; read them through `normaliseUseCase`. */
  type: "scheme" | "city_survey";
  intent?: SchemeIntent | null;
  scheme_ids: string[];
  survey_id?: string | null;
}

export type CallResponseStatus = "pending" | "answered" | "busy" | "no_answer" | "failed" | "cancelled";

export interface OutboundCallRequest {
  agent_id: string;
  to_number: string;
  from_number?: string;
  custom_variables?: Record<string, unknown>;
}

export interface OutboundCallResponse {
  call_id: string;
  status: CallLogStatus;
  provider_call_sid?: string | null;
  from_number: string;
  to_number: string;
  agent_id: string;
  custom_variables: Record<string, unknown>;
}

export interface WebCallRegisterRequest {
  agent_id: string;
  custom_variables?: Record<string, unknown>;
}

export interface WebCallRegisterResponse {
  call_id: string;
  status: CallLogStatus;
  call_type: CallType;
  agent_id: string;
  custom_variables: Record<string, unknown>;
}

export type KnowledgeDocumentStatus = "processing" | "ready" | "failed";

export interface KnowledgeDocumentItem {
  document_id: string;
  org_id: string;
  original_filename: string;
  status: KnowledgeDocumentStatus;
  chunk_count?: number | null;
  embedding_model?: string | null;
  storage_key?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallLogItem {
  call_id: string;
  org_id: string;
  agent_id: string;
  agent_name?: string | null;
  call_type: CallType;
  status: CallLogStatus;
  call_response?: CallResponseStatus | null;
  from_number: string;
  to_number: string;
  telephony_provider?: string | null;
  provider_call_sid?: string | null;
  custom_variables: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  start_time_utc?: string | null;
  end_time_utc?: string | null;
  duration?: number | null;
  recording_url?: string | null;
  transcript_url?: string | null;
  error_message?: string | null;
  campaign_id?: string | null;
  queued_run_id?: string | null;
  contact_id?: string | null;
  /** Outcome, sentiment, summary and agent feedback. Viewers get outcome only. */
  analysis?: CallAnalysis | null;
  /** "synthetic_mock" for made-up test transcripts from the mock provider. */
  transcript_source?: string | null;
}

export type CallOutcome =
  | "interested"
  | "not_interested"
  | "callback"
  | "wrong_person"
  | "no_answer"
  | "unclear"
  | "will_apply"
  | "already_enrolled"
  | "informed"
  | "issue_reported"
  | "no_issue"
  | "survey_completed"
  | "survey_partial"
  | "survey_declined";

export interface CallAnalysis {
  outcome: CallOutcome;
  outcome_label: string;
  analysed_at?: string | null;
  sentiment?: "positive" | "neutral" | "negative";
  summary?: string;
  feedback?: string[];
  feedback_codes?: string[];
  /** "llm" (the organisation's OpenAI key) or "rules" (built-in, offline). */
  engine?: "llm" | "rules";
  transcript_source?: string | null;
  /** Problem types the caller mentioned. */
  issues?: string[];
  /** The other intent whose path the call took (e.g. an awareness call that became support). */
  switched_to?: SchemeIntent | null;
  /** City survey answers, keyed by question id (rating 1-5, yes/no, or short text). */
  survey?: {
    survey_id: string;
    answers: Record<string, number | boolean | string>;
    answered: number;
    questions: number;
    themes: string[];
  } | null;
}

export interface CallLogListResponse {
  calls: CallLogItem[];
  limit: number;
  offset: number;
  total: number;
}

/** turns[] has two entries per turn_number: a "started" record and a
 * "duration_secs/was_interrupted" record written when the turn ends. */
export interface CallMetricsTurnRecord {
  turn_number: number;
  started?: boolean;
  duration_secs?: number;
  was_interrupted?: boolean;
}

export interface CallMetricsTtfbEntry {
  processor: string;
  model: string;
  start_time: number;
  duration_secs: number;
  /** Pipeline role stamped at write time (stt/llm/tts). Prefer over name heuristics. */
  stage?: "stt" | "llm" | "tts";
}

/** breakdowns[] aligns positionally with turns[] (breakdowns[i] ↔ turn_number i+1).
 * A null user_turn_start_time means the entry is bot-initiated speech (e.g. an
 * opening greeting), not a real user turn. */
export interface CallMetricsBreakdown {
  ttfb: CallMetricsTtfbEntry[];
  text_aggregation?: { processor: string; start_time: number; duration_secs: number } | null;
  user_turn_start_time?: number | null;
  user_turn_secs?: number | null;
  function_calls?: unknown[];
}

export interface CallMetricsResponse {
  call_id: string;
  org_id: string;
  recorded_at: string;
  summary: {
    turn_count?: number;
    interrupted_turn_count?: number;
    user_bot_latency_avg_secs?: number;
    user_bot_latency_min_secs?: number;
    user_bot_latency_max_secs?: number;
    /** Computed server-side (not stored) from the ttfb breakdowns at read
     * time: the sum of whichever of avg_stt/avg_tts/avg_llm are available. */
    avg_stt_secs?: number | null;
    avg_tts_secs?: number | null;
    avg_llm_secs?: number | null;
    avg_latency_secs?: number | null;
    [key: string]: unknown;
  };
  transport?: {
    start_time?: number;
    bot_connected_secs?: number | null;
    client_connected_secs?: number;
    [key: string]: unknown;
  } | null;
  turns: CallMetricsTurnRecord[];
  latencies: {
    first_bot_speech_secs?: number;
    user_to_bot_secs?: number[];
    breakdowns?: CallMetricsBreakdown[];
    [key: string]: unknown;
  };
}

export interface ProviderAuthResponse {
  org_id: string;
  provider: string;
  auth: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export type CampaignState = "created" | "syncing" | "running" | "paused" | "completed" | "failed";

export interface CampaignApiResponse {
  campaign_id: string;
  org_id: string;
  name: string;
  agent_id: string;
  source_type: string;
  source_id: string;
  state: CampaignState;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  rate_limit_per_second: number;
  retry_config: Record<string, unknown>;
  orchestrator_metadata: Record<string, unknown>;
  from_number?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface CampaignCsvUploadResponse {
  source_id: string;
  /** "secure_contacts" when numbers were hashed and encrypted on upload. */
  source_type?: string;
  filename: string;
  contact_rows: number;
  new_contacts?: number;
  protected?: boolean;
}

export interface CampaignRetryConfig {
  enabled: boolean;
  max_retries: number;
  retry_delay_seconds: number;
  retry_on_busy: boolean;
  retry_on_no_answer: boolean;
  retry_on_voicemail: boolean;
}

export interface CampaignScheduleSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CampaignScheduleConfig {
  enabled: boolean;
  timezone: string;
  slots: CampaignScheduleSlot[];
}

export interface CreateCampaignPayload {
  name: string;
  agent_id: string;
  source_type: string;
  source_id: string;
  rate_limit_per_second?: number;
  max_concurrency?: number;
  from_number?: string | null;
  retry_config?: CampaignRetryConfig;
}

/** GET /campaign/{id}/runs returns raw call-log dicts server-side — only a
 * loose shape is guaranteed, so treat unlisted fields as unknown. */
export interface CampaignRunItem {
  call_id?: string;
  to_number?: string;
  status?: string;
  call_response?: string | null;
  duration?: number | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface AgentCallCount {
  agent_id: string | null;
  agent_name: string | null;
  call_count: number;
}

export interface ModelUsageEntry {
  model: string | null;
  provider: string | null;
  call_count: number;
}

export interface ModelUsageSummary {
  stt: ModelUsageEntry | null;
  tts: ModelUsageEntry | null;
  llm: ModelUsageEntry | null;
}

export interface CallAnalyticsResponse {
  calls_attempted: number;
  calls_connected: number;
  calls_failed: number;
  connection_rate: number;
  total_duration_seconds: number;
  average_duration_seconds: number;
  trend_vs_last_week_pct: number | null;
  agent_performance: AgentCallCount[];
  model_usage: ModelUsageSummary;
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------

export interface CopilotContext {
  route?: string;
  agent_id?: string;
  call_id?: string;
  campaign_id?: string;
}

export interface CopilotToolCallRecord {
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  summary?: string | null;
}

export interface CopilotAttachmentRef {
  attachment_id: string;
  content_type: string;
  original_filename: string;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  tool_calls: CopilotToolCallRecord[];
  attachments?: CopilotAttachmentRef[];
}

export interface CopilotConversationSummary {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CopilotConversationDetail {
  conversation_id: string;
  org_id: string;
  title: string;
  messages: CopilotMessage[];
  created_at: string;
  updated_at: string;
}

export interface CopilotAgentDraftConfirmResponse {
  agent_id: string;
  name: string;
  status: string;
}

export interface CopilotCampaignDraftConfirmResponse {
  campaign_id: string;
  name: string;
  state: string;
}

export interface CopilotVoiceSessionCreateResponse {
  session_id: string;
  ws_path: string;
  conversation_id: string | null;
}

/** One parsed Copilot SSE event (see apps/api/app/services/copilot/engine.py). */
export type CopilotStreamEvent =
  | { type: "start"; conversation_id: string | null }
  | { type: "token"; text: string }
  | { type: "tool_call"; tool: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; tool: string; ok: boolean; data: unknown }
  | { type: "done"; conversation_id: string | null; text: string }
  | { type: "error"; message: string }
  /** The model provider rate-limited this request and the engine is
   * automatically waiting out its own stated retry time before trying
   * again — shown as live status, not an error, since it usually recovers. */
  | { type: "retry_wait"; seconds: number; message: string };
