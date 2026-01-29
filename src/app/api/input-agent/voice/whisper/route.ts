import { NextRequest } from 'next/server';
import { createApiResponse, createErrorResponse, ApiErrorCode } from '../../../../../lib/api/response';
import { handleOptions } from '../../../../../lib/api/cors';
import { apiRateLimit } from '../../../../../lib/rate-limit';
import { verifyAuthAndGetUser } from '../../../../../middleware/auth';

/**
 * @swagger
 * /api/input-agent/voice/whisper:
 *   post:
 *     summary: Transcribe audio using Whisper
 *     description: Transcribe audio file using Whisper API (Groq)
 *     tags: [Input Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Audio file to transcribe
 *     responses:
 *       200:
 *         description: Audio transcribed successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         transcript:
 *                           type: string
 *                         confidence:
 *                           type: number
 *                         language:
 *                           type: string
 *       400:
 *         description: Audio file is required
 */

export async function OPTIONS() {
  return handleOptions();
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (!rateLimitResult.success) {
    return createErrorResponse('Rate limit exceeded', 429);
  }

  const authResult = await verifyAuthAndGetUser(request);
  if (!authResult.success) {
    return createErrorResponse(authResult.error!, 401, ApiErrorCode.INVALID_SESSION);
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return createErrorResponse('Audio file is required', 400, ApiErrorCode.INVALID_INPUT);
    }

    // TODO: Implement Whisper API integration (Groq)
    // For now, return a mock response
    const mockTranscript = {
      text: "This is a mock transcript. Implement Whisper API integration here.",
      confidence: 0.95,
      language: "en"
    };

    return createApiResponse({
      transcript: mockTranscript.text,
      confidence: mockTranscript.confidence,
      language: mockTranscript.language,
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return createErrorResponse('Failed to transcribe audio', 500, ApiErrorCode.EXTERNAL_SERVICE_ERROR);
  }
}
