/**
 * Plugin hook types - minimal definitions for type safety
 */

export interface MessagePart {
  type: string;
  text?: string;
  ignored?: boolean;
  snippetsProcessed?: boolean;
}

export interface ChatMessageInput {
  sessionID: string;
}

export interface ChatMessageOutput {
  message: {
    role: string;
  };
  parts: MessagePart[];
}

export interface TransformMessageInfo {
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

export interface SessionIdleEvent {
  sessionID: string;
}
