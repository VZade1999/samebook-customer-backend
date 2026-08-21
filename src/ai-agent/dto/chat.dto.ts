import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  // Conversation context is no longer accepted from the client — it's
  // loaded server-side from ai_agent_messages (see AiAgentService), keyed
  // to the authenticated user. That also closes off the prompt-injection
  // surface a client-supplied history previously had (forging a 'system'
  // or 'tool' role message into the conversation the model trusts).
}
