import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  AI_PROVIDER_IDS,
  aiSettingsSchema,
  askRequestSchema,
  type AskRequest,
  receiptElementSchema,
  type AiProviderId,
  type AiSettings,
} from '@shoppos/shared';
import { badRequest } from '../../common/app-exception';
import { CurrentActor, RequirePermissions, type Actor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { CashRegisterModule } from '../cash-register/cash-register.controller';
import { InventoryModule } from '../inventory/inventory.controller';
import { ReportsModule } from '../reports/reports.controller';
import { AiError } from './ai-error';
import { AiKeysService } from './ai-keys.service';
import { AiService } from './ai.service';
import { AskService } from './ask.service';
import { AssistantService } from './assistant.service';
import { MAX_AUDIO_BYTES } from './openai-compat';

const message = z.string().trim().min(1, 'Type a request').max(500, 'Keep the request short');

const receiptRequestSchema = z.object({
  message,
  layout: z.array(receiptElementSchema).max(80),
  selectedIds: z.array(z.string().max(40)).max(80).default([]),
  copies: z.int().min(1).max(3).default(1),
});

const settingsRequestSchema = z.object({ message });

/** A voice message, base64 (the browser records it as webm, ogg or mp4). */
const voiceSchema = z.object({
  audio: z
    .string()
    .min(100, 'The voice message is empty')
    .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4, 'Keep voice messages under two minutes')
    .regex(/^[A-Za-z0-9+/]+=*$/, 'Not a voice message'),
  type: z
    .string()
    .max(80)
    .regex(/^audio\/[\w.+-]+(;\s*codecs=[\w.,"' -]+)?$/i, 'Not a voice message'),
});

/** An API key: one line of letters, digits and - _ . : (what the services hand out). */
const keySchema = z.object({
  key: z
    .string()
    .trim()
    .min(10, 'Paste the whole key')
    .max(400)
    .regex(/^[\w\-.:]+$/, 'A key has no spaces; copy it again'),
});
const testSchema = z.object({ ai: aiSettingsSchema, key: z.string().trim().max(400).optional() });

function provider(id: string): AiProviderId {
  if (!AI_PROVIDER_IDS.includes(id as AiProviderId)) throw badRequest(`Unknown AI service "${id}"`);
  return id as AiProviderId;
}

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly ask: AskService,
    private readonly ai: AiService,
    private readonly keys: AiKeysService,
  ) {}

  /** "Ask" on every page: any signed-in user; each answer checks what this user may see. */
  @Post('ask')
  @HttpCode(200)
  askQuestion(@Body(new ZodPipe(askRequestSchema)) body: AskRequest, @CurrentActor() actor: Actor) {
    return this.ask.ask(body, actor);
  }

  /** Can the assistant use an AI and read voice messages? (For everyone; nothing secret.) */
  @Get('abilities')
  abilities() {
    return this.ai.abilities();
  }

  /** A voice message in any language, turned into text (then sent to Ask like a typed one). */
  @Post('voice')
  @HttpCode(200)
  async voice(@Body(new ZodPipe(voiceSchema)) body: z.infer<typeof voiceSchema>) {
    const audio = Buffer.from(body.audio, 'base64');
    if (audio.length > MAX_AUDIO_BYTES) throw badRequest('Keep voice messages under two minutes');
    try {
      return { text: await this.ai.transcribe(audio, body.type.split(';')[0]!) };
    } catch (err) {
      if (err instanceof AiError) throw badRequest(err.message);
      throw err;
    }
  }

  /** Is an AI on, and which one? (No key, no internet needed.) */
  @Get('status')
  @RequirePermissions('settings.manage')
  status() {
    return this.ai.status();
  }

  /** Try an AI with settings that are not saved yet, and optionally a key not saved yet. */
  @Post('test')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  test(@Body(new ZodPipe(testSchema)) body: { ai: AiSettings; key?: string }) {
    return this.ai.test(body.ai, body.key);
  }

  /** Save the key for an online AI service (stored encrypted, never sent back). */
  @Put('keys/:provider')
  @RequirePermissions('settings.manage')
  async saveKey(
    @Param('provider') id: string,
    @Body(new ZodPipe(keySchema)) body: { key: string },
    @CurrentActor() actor: Actor,
  ) {
    await this.keys.set(provider(id), body.key, actor);
    return this.ai.status();
  }

  @Delete('keys/:provider')
  @RequirePermissions('settings.manage')
  async removeKey(@Param('provider') id: string, @CurrentActor() actor: Actor) {
    await this.keys.remove(provider(id), actor);
    return this.ai.status();
  }

  /** A request about the receipt design: answers with actions the editor carries out. */
  @Post('receipt')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  receipt(@Body(new ZodPipe(receiptRequestSchema)) body: z.infer<typeof receiptRequestSchema>) {
    return this.assistant.receipt(body);
  }

  /** A request about settings: answers with changes the owner checks before saving. */
  @Post('settings')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  settings(@Body(new ZodPipe(settingsRequestSchema)) body: z.infer<typeof settingsRequestSchema>) {
    return this.assistant.settingsChange(body.message);
  }
}

@Module({
  imports: [ReportsModule, InventoryModule, CashRegisterModule],
  controllers: [AssistantController],
  providers: [AssistantService, AskService, AiService, AiKeysService],
})
export class AssistantModule {}
