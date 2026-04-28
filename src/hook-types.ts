/**
 * Plugin hook types - minimal definitions for type safety
 */

export interface MessagePart {
  type: string;
  text?: string;
  ignored?: boolean;
  synthetic?: boolean;
  snippetsProcessed?: boolean;
  skillLoads?: string[];
}

export interface ChatMessageInput {
  sessionID: string;
  messageID?: string;
}

export interface ChatMessageOutput {
  message: {
    role: string;
  };
  parts: MessagePart[];
}

export interface TransformMessageInfo {
  id?: string;
  role: string;
  sessionID?: string;
}

export interface TransformMessage {
  info: TransformMessageInfo;
  parts: MessagePart[];
}

export interface TransformInput {
  sessionID?: string;
  session?: {
    id?: string;
  };
}

export interface TransformOutput {
  messages: TransformMessage[];
}

export interface SystemTransformInput {
  sessionID?: string;
  model?: unknown;
}

export interface SystemTransformOutput {
  system: string[];
}

export interface SessionIdleEvent {
  sessionID: string;
}
