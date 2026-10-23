import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { aiSettingsSchema, receiptElementSchema, type AiSettings } from '@shoppos/shared';
import { RequirePermissions } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { AssistantService } from './assistant.service';

const message = z.string().trim().min(1, 'Type a request').max(500, 'Keep the request short');

const receiptRequestSchema = z.object({
  message,
  layout: z.array(receiptElementSchema).max(80),
  selectedIds: z.array(z.string().max(40)).max(80).default([]),
  copies: z.int().min(1).max(3).default(1),
});

const settingsRequestSchema = z.object({ message });

/** The assistant is part of Settings and the receipt editor, so it needs settings.manage. */
@Controller('assistant')
@RequirePermissions('settings.manage')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Is the local AI model on, running and downloaded? */
  @Get('status')
  status() {
    return this.assistant.status();
  }

  /** Check an AI server address and model before saving them. */
  @Post('test')
  @HttpCode(200)
  test(@Body(new ZodPipe(aiSettingsSchema)) body: AiSettings) {
    return this.assistant.status(body, true);
  }

  /** A request about the receipt design: answers with actions the editor carries out. */
  @Post('receipt')
  @HttpCode(200)
  receipt(@Body(new ZodPipe(receiptRequestSchema)) body: z.infer<typeof receiptRequestSchema>) {
    return this.assistant.receipt(body);
  }

  /** A request about settings: answers with changes the owner checks before saving. */
  @Post('settings')
  @HttpCode(200)
  settings(@Body(new ZodPipe(settingsRequestSchema)) body: z.infer<typeof settingsRequestSchema>) {
    return this.assistant.settingsChange(body.message);
  }
}

@Module({
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
