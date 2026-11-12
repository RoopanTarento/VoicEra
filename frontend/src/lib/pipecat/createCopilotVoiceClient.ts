import { PipecatClient } from "@pipecat-ai/client-js";
import {
  ProtobufFrameSerializer,
  WebSocketTransport,
} from "@pipecat-ai/websocket-transport";
import { createCopilotVoiceSession } from "@/lib/api/copilot";

/** Matches runtime `WEBSOCKET_SAMPLE_RATE` (default 16000) — same as browser test calls. */
export const COPILOT_VOICE_SAMPLE_RATE = 16000;

/** Same-origin WebSocket — Next rewrites `/copilot-agent/*` → runtime (next.config.ts). */
export function getCopilotVoiceWsUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/copilot-agent/${sessionId}`;
}

/** Pipecat client for the Copilot voice session (protobuf WebSocket, same shape
 * as createBrowserPipecatClient — this is a Copilot conversation, not a call
 * to a stored VoicERA agent, but the transport/client wiring is identical). */
export function createCopilotVoicePipecatClient(): PipecatClient {
  return new PipecatClient({
    transport: new WebSocketTransport({
      serializer: new ProtobufFrameSerializer(),
      recorderSampleRate: COPILOT_VOICE_SAMPLE_RATE,
      playerSampleRate: COPILOT_VOICE_SAMPLE_RATE,
    }),
    enableMic: true,
    enableCam: false,
  });
}

/** Create a voice session (optionally linked to an existing text conversation
 * so voice and text share history), then connect the client to it. Returns
 * the session_id so the caller can end it explicitly on hangup. */
export async function connectCopilotVoice(
  client: PipecatClient,
  conversationId?: string,
): Promise<string> {
  const session = await createCopilotVoiceSession(conversationId);
  await client.connect({ wsUrl: getCopilotVoiceWsUrl(session.session_id) });
  return session.session_id;
}
